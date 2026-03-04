import { expect, test } from "@playwright/test";
import { signIn } from "./utils/auth";

const ANALYTICS_EMAIL = "test-analytics@techops.services";
const ANALYTICS_PASSWORD = "TestAnalytics123!";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Analytics Gas Tracking", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("Gas Spent KPI card shows non-zero value", async ({ page }) => {
    await signIn(page, ANALYTICS_EMAIL, ANALYTICS_PASSWORD);
    await page.goto("/analytics", { waitUntil: "domcontentloaded" });

    // Switch to 7d range (seed data spans 7 days)
    const rangeButton = page.locator(
      'nav[aria-label="Time range"] button:has-text("7d")'
    );
    await rangeButton.click();

    // Wait for summary API response
    await page.waitForResponse(
      (res) =>
        res.url().includes("/api/analytics/summary") && res.status() === 200,
      { timeout: 15_000 }
    );

    // Find the Gas Spent KPI card
    const gasLabel = page.locator('p.text-sm:has-text("Gas Spent")');
    await expect(gasLabel).toBeVisible({ timeout: 10_000 });

    // The value is the sibling <p> with text-2xl
    const gasValue = gasLabel.locator("..").locator("p.text-2xl");
    await expect(gasValue).toBeVisible();
    await expect(gasValue).not.toHaveText("0 ETH", { timeout: 10_000 });
  });

  test("workflow runs table loads with data", async ({ page }) => {
    await signIn(page, ANALYTICS_EMAIL, ANALYTICS_PASSWORD);
    await page.goto("/analytics", { waitUntil: "domcontentloaded" });

    // Switch to 7d range
    await page
      .locator('nav[aria-label="Time range"] button:has-text("7d")')
      .click();

    // Wait for initial runs load
    await page.waitForResponse(
      (res) =>
        res.url().includes("/api/analytics/runs") && res.status() === 200,
      { timeout: 15_000 }
    );

    // Filter by workflow source: set up listener BEFORE clicking
    const workflowFilter = page.locator(
      'nav[aria-label="Source"] button:has-text("Workflow")'
    );
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/analytics/runs") && res.status() === 200,
        { timeout: 15_000 }
      ),
      workflowFilter.click(),
    ]);

    // Table rows (may need scrolling into view)
    const rows = page.locator("table tbody tr");
    await rows.first().scrollIntoViewIfNeeded();
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });

    // Verify at least one workflow run row exists
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("network breakdown API includes workflow gas", async ({ page }) => {
    await signIn(page, ANALYTICS_EMAIL, ANALYTICS_PASSWORD);
    await page.goto("/analytics", { waitUntil: "domcontentloaded" });

    // Hit the networks endpoint directly via the page context (inherits auth cookies)
    const response = await page.request.get("/api/analytics/networks?range=7d");
    const responseBody = await response.text();
    expect(
      response.ok(),
      `Networks API returned ${response.status()}: ${responseBody}`
    ).toBe(true);

    const data = await response.json();
    expect(data.networks.length).toBeGreaterThan(0);

    // Seed data uses chain IDs 1, 137, 8453, 11155111 for workflow gas
    const networkIds = data.networks.map((n: { network: string }) => n.network);

    // At least one workflow chain ID should be present
    const workflowChainIds = ["1", "137", "8453", "11155111"];
    const hasWorkflowNetwork = workflowChainIds.some((id) =>
      networkIds.includes(id)
    );
    expect(hasWorkflowNetwork).toBe(true);

    // All networks should have non-zero gas
    for (const network of data.networks) {
      expect(BigInt(network.totalGasWei)).toBeGreaterThan(BigInt(0));
    }
  });
});
