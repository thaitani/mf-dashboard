import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const DEFAULT_DB_PATH = "data/moneyforward.db";
const DEFAULT_BACKUP_DIR = "backups";
const BACKUP_PREFIX = "moneyforward";
const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

interface BackupOptions {
  backupDir: string;
  keepCount: number | null;
  now: Date;
  preferSqliteBackup?: boolean;
  skipMissing: boolean;
  sourcePath: string;
}

interface BackupResult {
  backupPath: string | null;
  method: "copy" | "sqlite";
  prunedPaths: string[];
  skipped: boolean;
}

type BackupEnvironment = Record<string, string | undefined>;
const execFileAsync = promisify(execFile);

export function formatBackupTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  const datePart = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("");
  const timePart = [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");

  return `${datePart}-${timePart}`;
}

export function parseKeepCount(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }

  const keepCount = Number(value);
  if (!Number.isInteger(keepCount) || keepCount < 1) {
    throw new Error("DB_BACKUP_KEEP must be a positive integer.");
  }

  return keepCount;
}

export function parseBoolean(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function resolveBackupOptions(
  env: BackupEnvironment = process.env,
  cwd = PROJECT_ROOT,
): BackupOptions {
  return {
    backupDir: path.resolve(cwd, env.DB_BACKUP_DIR ?? DEFAULT_BACKUP_DIR),
    keepCount: parseKeepCount(env.DB_BACKUP_KEEP),
    now: new Date(),
    skipMissing: parseBoolean(env.DB_BACKUP_SKIP_MISSING),
    sourcePath: path.resolve(cwd, env.DB_BACKUP_SOURCE ?? DEFAULT_DB_PATH),
  };
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function nextBackupPath(backupDir: string, timestamp: string): Promise<string> {
  const basePath = path.join(backupDir, `${BACKUP_PREFIX}-${timestamp}.db`);

  for (let index = 0; index < 1000; index++) {
    const candidate =
      index === 0
        ? basePath
        : path.join(backupDir, `${BACKUP_PREFIX}-${timestamp}-${index}.db`);

    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }

  throw new Error(`Could not find an available backup file name in ${backupDir}`);
}

async function pruneBackups(
  backupDir: string,
  keepCount: number | null,
): Promise<string[]> {
  if (keepCount === null) {
    return [];
  }

  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const backupFileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) =>
      /^moneyforward-\d{8}-\d{6}(?:-\d+)?\.db$/.test(name),
    )
    .sort()
    .reverse();

  const prunedPaths = backupFileNames
    .slice(keepCount)
    .map((name) => path.join(backupDir, name));

  await Promise.all(prunedPaths.map((filePath) => fs.unlink(filePath)));

  return prunedPaths;
}

function quoteSqliteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function isCommandNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function backupWithSqlite(
  sourcePath: string,
  backupPath: string,
): Promise<boolean> {
  try {
    await execFileAsync("sqlite3", [
      sourcePath,
      `VACUUM INTO ${quoteSqliteString(backupPath)};`,
    ]);
    return true;
  } catch (error) {
    if (isCommandNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

export async function backupDatabase(
  options: BackupOptions,
): Promise<BackupResult> {
  if (!(await isReadableFile(options.sourcePath))) {
    if (options.skipMissing) {
      return {
        backupPath: null,
        method: "copy",
        prunedPaths: [],
        skipped: true,
      };
    }

    throw new Error(
      `Database file was not found or is not readable: ${options.sourcePath}`,
    );
  }

  await fs.mkdir(options.backupDir, { recursive: true });

  const timestamp = formatBackupTimestamp(options.now);
  const backupPath = await nextBackupPath(options.backupDir, timestamp);

  const shouldUseSqliteBackup = options.preferSqliteBackup ?? true;
  const usedSqliteBackup = shouldUseSqliteBackup
    ? await backupWithSqlite(options.sourcePath, backupPath)
    : false;

  if (!usedSqliteBackup) {
    await fs.copyFile(options.sourcePath, backupPath, constants.COPYFILE_EXCL);
  }

  const prunedPaths = await pruneBackups(options.backupDir, options.keepCount);

  return {
    backupPath,
    method: usedSqliteBackup ? "sqlite" : "copy",
    prunedPaths,
    skipped: false,
  };
}

async function main(): Promise<void> {
  const result = await backupDatabase(resolveBackupOptions());

  if (result.skipped) {
    console.log("Database backup skipped because the source database does not exist.");
    return;
  }

  console.log(`Backed up database to ${result.backupPath} (${result.method})`);

  if (result.prunedPaths.length > 0) {
    console.log(`Pruned ${result.prunedPaths.length} old backup(s).`);
  }
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);

if (isCli) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
