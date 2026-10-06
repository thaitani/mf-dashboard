import type { Page } from "playwright";
import { describe, expect, test, vi } from "vitest";
import { navigateWithRetry } from "./navigation.js";

function createPage(goto: Page["goto"], isClosed = false): Page {
  return {
    goto,
    isClosed: vi.fn(() => isClosed),
  } as unknown as Page;
}

describe("navigateWithRetry", () => {
  test("retries once when Playwright aborts navigation", async () => {
    const goto = vi
      .fn<Page["goto"]>()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_ABORTED at https://example.test"))
      .mockResolvedValueOnce(null);
    const page = createPage(goto);

    await navigateWithRetry(page, "https://example.test", { retryDelayMs: 0 });

    expect(goto).toHaveBeenCalledTimes(2);
    expect(goto).toHaveBeenNthCalledWith(1, "https://example.test", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  });

  test("does not retry non-navigation errors", async () => {
    const error = new Error("selector not found");
    const goto = vi.fn<Page["goto"]>().mockRejectedValueOnce(error);
    const page = createPage(goto);

    await expect(
      navigateWithRetry(page, "https://example.test", { retryDelayMs: 0 }),
    ).rejects.toBe(error);

    expect(goto).toHaveBeenCalledTimes(1);
  });

  test("does not retry after the page is closed", async () => {
    const error = new Error("page.goto: net::ERR_ABORTED");
    const goto = vi.fn<Page["goto"]>().mockRejectedValueOnce(error);
    const page = createPage(goto, true);

    await expect(
      navigateWithRetry(page, "https://example.test", { retryDelayMs: 0 }),
    ).rejects.toBe(error);

    expect(goto).toHaveBeenCalledTimes(1);
  });
});
