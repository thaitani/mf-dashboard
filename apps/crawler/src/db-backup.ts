import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { info } from "./logger.js";

const execFileAsync = promisify(execFile);
const CRAWLER_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function backupDatabaseBeforeCrawlerRun(): Promise<void> {
  info("Backing up database before crawler run...");

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "../../scripts/db-backup.ts"],
    {
      cwd: CRAWLER_ROOT,
      env: {
        ...process.env,
        DB_BACKUP_SKIP_MISSING: process.env.DB_BACKUP_SKIP_MISSING ?? "true",
      },
    },
  );

  if (stdout.trim()) {
    info(stdout.trim());
  }

  if (stderr.trim()) {
    info(stderr.trim());
  }
}
