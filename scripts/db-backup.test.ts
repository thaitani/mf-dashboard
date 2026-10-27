import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  backupDatabase,
  formatBackupTimestamp,
  parseBoolean,
  parseKeepCount,
  resolveBackupOptions,
} from "./db-backup.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mf-dashboard-backup-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })),
  );
});

describe("formatBackupTimestamp", () => {
  test("formats a local timestamp for backup file names", () => {
    const date = new Date(2026, 9, 6, 17, 18, 55);

    expect(formatBackupTimestamp(date)).toBe("20261006-171855");
  });
});

describe("parseKeepCount", () => {
  test("returns null when pruning is not configured", () => {
    expect(parseKeepCount(undefined)).toBeNull();
    expect(parseKeepCount("")).toBeNull();
  });

  test("requires a positive integer", () => {
    expect(parseKeepCount("3")).toBe(3);
    expect(() => parseKeepCount("0")).toThrow("DB_BACKUP_KEEP");
    expect(() => parseKeepCount("1.5")).toThrow("DB_BACKUP_KEEP");
  });
});

describe("parseBoolean", () => {
  test("accepts true values used by shell environments", () => {
    expect(parseBoolean("1")).toBe(true);
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean("")).toBe(false);
    expect(parseBoolean(undefined)).toBe(false);
  });
});

describe("resolveBackupOptions", () => {
  test("uses default source and backup paths from the current working directory", () => {
    const cwd = "/workspace/project";

    expect(resolveBackupOptions({}, cwd)).toMatchObject({
      backupDir: "/workspace/project/backups",
      keepCount: null,
      skipMissing: false,
      sourcePath: "/workspace/project/data/moneyforward.db",
    });
  });

  test("allows source, destination, and retention to be configured", () => {
    const cwd = "/workspace/project";

    expect(
      resolveBackupOptions(
        {
          DB_BACKUP_DIR: "/tmp/db-backups",
          DB_BACKUP_KEEP: "5",
          DB_BACKUP_SKIP_MISSING: "true",
          DB_BACKUP_SOURCE: "data/demo.db",
        },
        cwd,
      ),
    ).toMatchObject({
      backupDir: "/tmp/db-backups",
      keepCount: 5,
      skipMissing: true,
      sourcePath: "/workspace/project/data/demo.db",
    });
  });
});

describe("backupDatabase", () => {
  test("copies the database to a timestamped backup file", async () => {
    const tempDir = await createTempDir();
    const sourcePath = path.join(tempDir, "source.db");
    const backupDir = path.join(tempDir, "backups");
    await fs.writeFile(sourcePath, "database content");

    const result = await backupDatabase({
      backupDir,
      keepCount: null,
      now: new Date(2026, 9, 6, 17, 18, 55),
      preferSqliteBackup: false,
      skipMissing: false,
      sourcePath,
    });

    const backupPath = result.backupPath;
    expect(backupPath).toBe(path.join(backupDir, "moneyforward-20261006-171855.db"));
    if (backupPath === null) throw new Error("Expected backup path");
    await expect(fs.readFile(backupPath, "utf8")).resolves.toBe("database content");
    expect(result.prunedPaths).toEqual([]);
    expect(result.method).toBe("copy");
  });

  test("does not overwrite an existing backup made in the same second", async () => {
    const tempDir = await createTempDir();
    const sourcePath = path.join(tempDir, "source.db");
    const backupDir = path.join(tempDir, "backups");
    await fs.mkdir(backupDir);
    await fs.writeFile(sourcePath, "new database content");
    await fs.writeFile(path.join(backupDir, "moneyforward-20261006-171855.db"), "old content");

    const result = await backupDatabase({
      backupDir,
      keepCount: null,
      now: new Date(2026, 9, 6, 17, 18, 55),
      preferSqliteBackup: false,
      skipMissing: false,
      sourcePath,
    });

    const backupPath = result.backupPath;
    expect(backupPath).toBe(path.join(backupDir, "moneyforward-20261006-171855-1.db"));
    if (backupPath === null) throw new Error("Expected backup path");
    await expect(fs.readFile(backupPath, "utf8")).resolves.toBe("new database content");
  });

  test("prunes older backup files when keep count is configured", async () => {
    const tempDir = await createTempDir();
    const sourcePath = path.join(tempDir, "source.db");
    const backupDir = path.join(tempDir, "backups");
    await fs.mkdir(backupDir);
    await fs.writeFile(sourcePath, "current database content");
    await fs.writeFile(path.join(backupDir, "moneyforward-20261003-000000.db"), "old");
    await fs.writeFile(path.join(backupDir, "moneyforward-20261004-000000.db"), "middle");

    const result = await backupDatabase({
      backupDir,
      keepCount: 2,
      now: new Date(2026, 9, 5, 0, 0, 0),
      preferSqliteBackup: false,
      skipMissing: false,
      sourcePath,
    });

    const backupPath = result.backupPath;
    if (backupPath === null) throw new Error("Expected backup path");
    expect(path.basename(backupPath)).toBe("moneyforward-20261005-000000.db");
    expect(result.prunedPaths.map((filePath) => path.basename(filePath))).toEqual([
      "moneyforward-20261003-000000.db",
    ]);

    await expect(fs.readdir(backupDir)).resolves.toEqual([
      "moneyforward-20261004-000000.db",
      "moneyforward-20261005-000000.db",
    ]);
  });

  test("skips missing source database when configured", async () => {
    const tempDir = await createTempDir();

    const result = await backupDatabase({
      backupDir: path.join(tempDir, "backups"),
      keepCount: null,
      now: new Date(2026, 9, 6, 17, 18, 55),
      preferSqliteBackup: false,
      skipMissing: true,
      sourcePath: path.join(tempDir, "missing.db"),
    });

    expect(result).toEqual({
      backupPath: null,
      method: "copy",
      prunedPaths: [],
      skipped: true,
    });
  });
});
