import { expect, test } from "./fixtures";
import {
  createTestWorkflow,
  deleteTestWorkflow,
  PERSISTENT_TEST_USER_EMAIL,
} from "./utils/db";
import { waitForCanvas } from "./utils/workflow";

test.describe("Stop Workflow Execution", () => {
  let workflowId: string;

  test.beforeEach(async () => {
    const workflow = await createTestWorkflow(PERSISTENT_TEST_USER_EMAIL, {
      name: `Stop Test ${Date.now()}`,
      triggerType: "manual",
      actionEndpoint: "https://httpbin.org/delay/10",
    });
    workflowId = workflow.id;
  });

  test.afterEach(async () => {
    if (workflowId) {
      await deleteTestWorkflow(workflowId);
    }
  });

  test.skip("stop button appears during execution and cancels the run", async ({
    page,
  }) => {
    await page.goto(`/workflows/${workflowId}`, {
      waitUntil: "domcontentloaded",
    });
    await waitForCanvas(page);

    // Click Run
    const runButton = page.locator('button[title="Run Workflow"]');
    await expect(runButton).toBeVisible({ timeout: 10_000 });
    await runButton.click();

    // Wait for Stop button to appear
    const stopButton = page.locator('button[title="Stop Execution"]');
    await expect(stopButton).toBeVisible({ timeout: 5000 });

    // Click Stop
    await stopButton.click();

    // Verify cancellation toast
    const cancelToast = page.locator(
      '[data-sonner-toast]:has-text("Workflow execution cancelled")'
    );
    await expect(cancelToast).toBeVisible({ timeout: 10_000 });

    // Verify Stop button is gone
    await expect(stopButton).not.toBeVisible({ timeout: 5000 });
  });
});
