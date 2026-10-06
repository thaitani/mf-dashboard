import type { Page } from "playwright";

const DEFAULT_NAVIGATION_RETRY_DELAY_MS = 1000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 60000;

interface NavigationOptions {
  retryDelayMs?: number;
  timeoutMs?: number;
}

function isRetryableNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("net::ERR_ABORTED") || message.includes("Timeout");
}

export async function navigateWithRetry(
  page: Page,
  url: string,
  options: NavigationOptions = {},
): Promise<void> {
  const MAX_RETRIES = 1;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_NAVIGATION_RETRY_DELAY_MS;
  const timeout = options.timeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout,
      });
      return;
    } catch (err) {
      if (page.isClosed()) {
        throw err;
      }

      if (!isRetryableNavigationError(err) || attempt === MAX_RETRIES) {
        throw err;
      }

      // A crashed Playwright page can reject page.waitForTimeout() and mask the
      // original navigation error. Use a process timer between attempts instead.
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
