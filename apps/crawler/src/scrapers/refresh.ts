import type { RefreshResult } from "@mf-dashboard/db/types";
import { mfUrls } from "@mf-dashboard/meta/urls";
import type { Page } from "playwright";
import { debug, info, warn } from "../logger.js";
import { navigateWithRetry } from "./navigation.js";

const DEFAULT_MAX_WAIT_MINUTES = 20;
const POLL_INTERVAL_MS = 30000; // 30 seconds
const IN_APP_MESSAGE_ROOT_SELECTOR = ".ab-iam-root.ab-show";
const IN_APP_MESSAGE_FRAME_SELECTOR =
  'iframe[title="Modal Message"], iframe.ab-in-app-message';
const IN_APP_MESSAGE_CLOSE_SELECTORS = [
  '[aria-label="Close"]',
  '[aria-label="close"]',
  '[aria-label="閉じる"]',
  ".ab-close-button",
  ".ab-close",
  'button:has-text("×")',
  'button:has-text("閉じる")',
];

export async function navigateToAccountsPage(
  page: Page,
  options: { retryDelayMs?: number } = {},
): Promise<void> {
  await navigateWithRetry(page, mfUrls.accounts, options);
}

export async function getRefreshStatus(
  page: Page,
): Promise<{ incompleteAccounts: string[]; remainingCount: number }> {
  const rows = page.locator("#account-table tr:has(td.account-status)");
  const count = await rows.count();
  const refreshRows: RefreshStatusRow[] = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const statuses = await row.locator("td.account-status").allTextContents();
    const nameLink = row.locator("td.service a").first();
    refreshRows.push({
      name: statuses.some((status) => status.trim() === "更新中")
        ? await ((await nameLink.count()) > 0 ? nameLink : row.locator("td").first()).textContent()
        : null,
      statuses,
    });
  }

  return summarizeRefreshRows(refreshRows);
}

export interface RefreshStatusRow {
  name: string | null;
  statuses: string[];
}

export function summarizeRefreshRows(rows: readonly RefreshStatusRow[]): {
  incompleteAccounts: string[];
  remainingCount: number;
} {
  const incompleteAccounts: string[] = [];
  let remainingCount = 0;

  for (const row of rows) {
    if (!row.statuses.some((status) => status.trim() === "更新中")) {
      continue;
    }

    remainingCount++;
    const accountName = row.name?.trim();
    if (accountName) {
      incompleteAccounts.push(accountName);
    }
  }

  return { incompleteAccounts, remainingCount };
}

interface RefreshWaitProgress {
  elapsedSeconds: number;
  incompleteAccounts: string[];
  maxWaitMinutes: number;
  nextCheckSeconds: number;
  remainingCount: number;
}

interface RefreshOptions {
  maxWaitMinutes?: number;
  pollIntervalMs?: number;
  onWaiting?: (progress: RefreshWaitProgress) => Promise<void> | void;
}

export function getMaxWaitMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const configuredValue = Number(env.MAX_WAIT_MINUTES);
  return Number.isFinite(configuredValue) && configuredValue > 0
    ? configuredValue
    : DEFAULT_MAX_WAIT_MINUTES;
}

export async function dismissInAppMessage(page: Page): Promise<void> {
  const modalRoot = page.locator(IN_APP_MESSAGE_ROOT_SELECTOR);
  if (!(await modalRoot.first().isVisible().catch(() => false))) {
    return;
  }

  debug("Dismissing in-app message overlay...");

  for (const selector of IN_APP_MESSAGE_CLOSE_SELECTORS) {
    const closeButton = page
      .frameLocator(IN_APP_MESSAGE_FRAME_SELECTOR)
      .locator(selector)
      .first();
    const clicked = await closeButton
      .click({ timeout: 1000 })
      .then(() => true)
      .catch(() => false);

    if (!clicked) {
      continue;
    }

    await modalRoot
      .first()
      .waitFor({ state: "hidden", timeout: 2000 })
      .catch(() => undefined);

    if (!(await modalRoot.first().isVisible().catch(() => false))) {
      return;
    }
  }

  warn("In-app message overlay could not be closed; hiding it before refresh click");
  await modalRoot.evaluateAll((elements) => {
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      element.style.display = "none";
      element.style.pointerEvents = "none";
      element.setAttribute("data-mf-dashboard-dismissed", "true");
    }
  });
}

export async function clickRefreshButton(
  page: Page,
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const maxWaitMinutes = options.maxWaitMinutes ?? getMaxWaitMinutes();
  const maxWaitTimeMs = maxWaitMinutes * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  debug("Looking for refresh button...");

  // Navigate to home and click refresh button
  await page.goto(mfUrls.home);
  await page.waitForLoadState("networkidle");
  await dismissInAppMessage(page);

  const refreshButton = page.locator('a:has-text("一括更新")').first();
  await refreshButton.click();

  info("Refreshing accounts...");

  // Wait for refresh to start
  await page.waitForTimeout(3000);

  // Navigate to accounts page to check update status
  await navigateToAccountsPage(page);

  info("Waiting for all updates to complete on /accounts page...");

  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTimeMs) {
    const { incompleteAccounts, remainingCount } = await getRefreshStatus(page);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    info(`[${elapsed}s] 残り: ${remainingCount}`);

    await options.onWaiting?.({
      elapsedSeconds: elapsed,
      incompleteAccounts,
      maxWaitMinutes,
      nextCheckSeconds: Math.round(pollIntervalMs / 1000),
      remainingCount,
    });

    if (remainingCount === 0) {
      info("All updates completed!");
      return { completed: true, incompleteAccounts: [] };
    }

    // Wait and navigate to accounts page again to get fresh status
    // Using goto instead of reload to avoid ERR_ABORTED when frame is detached
    await page.waitForTimeout(pollIntervalMs);
    await navigateToAccountsPage(page);
  }

  // Timeout: get list of accounts still updating
  const { incompleteAccounts, remainingCount } = await getRefreshStatus(page);

  warn(`Max wait time exceeded. ${incompleteAccounts.length} accounts still updating:`);
  for (const account of incompleteAccounts) {
    warn(`  - ${account}`);
  }

  return { completed: false, incompleteAccounts, remainingCount };
}
