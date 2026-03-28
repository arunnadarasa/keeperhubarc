import { expect, test } from "@playwright/test";

test.describe("Evaluation Harness Smoke Tests", () => {
  test("health endpoint returns 200 @autonomous", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
  });

  test("dashboard renders for authenticated user @autonomous", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('button[role="combobox"]', {
      state: "visible",
      timeout: 15_000,
    });
    await expect(page.locator('button[role="combobox"]')).toBeVisible();
  });
});
