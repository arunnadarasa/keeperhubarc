---
description: Test a deployed PR environment end-to-end
argument-hint: <PR_NUMBER>
allowed-tools: Bash, Read, Glob, Grep, WebFetch, mcp__playwright__*, mcp__claude-in-chrome__*
---

Test a deployed PR environment end-to-end: pre-flight, seed, smoke test, feature test, and report.

## Arguments

$ARGUMENTS should be the PR number to test. Example: `427`.

## Instructions

Follow this exact workflow in order. Do NOT skip pre-flight or proceed past a blocking failure.

### Step 0: Validate arguments and set variables

Set the following from $ARGUMENTS and constants:

```
PR_NUMBER=$ARGUMENTS
APP_URL=https://app-pr-${PR_NUMBER}.keeperhub.com
TEST_EMAIL=pr-test-do-not-delete@techops.services
TEST_PASSWORD=TestPassword123!
```

Validate that PR_NUMBER is a positive integer. If not, abort with an error message.

**Cloudflare Access**: PR environments are behind Cloudflare Access. The env vars `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` must be set. Verify they exist:

```bash
[[ -n "${CF_ACCESS_CLIENT_ID:-}" && -n "${CF_ACCESS_CLIENT_SECRET:-}" ]] && echo "CF tokens found" || echo "WARNING: CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET not set -- browser tests will fail"
```

If missing, warn the user and ask them to set the env vars before proceeding to browser tests.

For all curl requests to APP_URL, include these headers:
```bash
-H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}"
```

The preflight script (`pr-preflight.sh`) picks up these env vars automatically.

### Step 1: Ensure PR environment is deployed

First, check if the PR has the `deploy-pr-environment` label:

```bash
gh pr view $PR_NUMBER --json labels --jq '.labels[].name' | grep -q "deploy-pr-environment"
```

If the label is missing, add it automatically:

```bash
gh pr edit $PR_NUMBER --add-label "deploy-pr-environment"
```

Then inform the user you added the label and that the environment will take a few minutes to deploy.

### Step 2: Pre-flight checks

Run the pre-flight script:

```bash
bash scripts/pr-test/pr-preflight.sh $PR_NUMBER
```

If the namespace does not exist yet (label was just added), wait 2 minutes and retry up to 3 times. The GitHub Action needs time to provision the environment.

If other checks fail after the namespace exists:
- Suggest specific fixes for each failure
- If pods are not ready, wait 1-2 minutes and retry (init containers may still be running)
- Do NOT proceed to Step 3 until all pre-flight checks pass

### Step 3: Extract DB credentials

Run the connection script to extract database credentials:

```bash
bash scripts/pr-test/pr-connect.sh $PR_NUMBER
```

This writes credentials to `/tmp/pr-test-${PR_NUMBER}.env`. Verify the file was created.

### Step 4: Seed test data

Run the seed script:

```bash
bash scripts/pr-test/pr-seed.sh $PR_NUMBER
```

Verify the output shows seeded records (users, workflows, executions). If the seed fails, check init container logs:

```bash
bash scripts/pr-test/pr-logs.sh $PR_NUMBER db-migration
```

### Step 5: Read PR context

Gather PR metadata to inform feature-specific testing:

```bash
gh pr view $PR_NUMBER --json title,body,files,labels
```

From the output:
- Identify changed features and components
- Map changed files to affected pages and flows (e.g., changes in `keeperhub/plugins/web3/` affect the action grid and workflow canvas)
- Record findings to guide Step 6

### Step 6: Smoke test (browser)

Use Playwright MCP for structured interactions and Claude-in-Chrome for visual inspection.

**Before navigating**, inject CF Access headers into the Playwright browser context so requests bypass Cloudflare Access:

```javascript
// Via mcp__playwright__browser_run_code
async (page) => {
  await page.context().setExtraHTTPHeaders({
    'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET
  });
  return 'CF Access headers set';
}
```

If `process.env` is not available in the browser context, pass the literal values from the shell env vars instead.

**6a. Landing page loads**
- Navigate to APP_URL
- Verify the page loads without errors
- Take a screenshot

**5b. Login with test user**
- Click the Sign In button
- Enter TEST_EMAIL and TEST_PASSWORD
- Submit and verify login succeeds (user menu visible, no error toasts)

**5c. Key pages load**
- Dashboard/home after login: verify it renders
- Workflow list: navigate and verify workflows appear
- Seeded workflow: navigate to /workflow/pr-test-wf-webhook
- Workflow canvas: verify it renders with trigger and action nodes visible

**5d. Record results**
- Record PASS/FAIL for each sub-check (6a through 6c)

### Step 7: Feature-specific testing (browser)

Based on the PR context from Step 5, test the specific changes:

- **UI changes**: Navigate to affected pages, verify rendering, interact with changed components
- **API changes**: Verify responses via browser network tab or curl against APP_URL
- **Workflow logic**: Create or run a workflow that exercises the changed code paths
- **Auth/session changes**: Test login, logout, session persistence
- **DB schema changes**: Verify seeded data renders correctly in the UI
- **Plugin changes**: Open the action grid and verify the plugin appears and its actions are selectable

Tailor tests to what actually changed. Do not test unchanged areas in this step.

### Step 8: Exploratory testing (browser)

**7a. Workflow creation**
- Click New Workflow
- Verify trigger node appears on canvas
- Click Add Step
- Verify action grid opens with available actions

**7b. Workflow execution**
- Open the seeded workflow (pr-test-wf-webhook)
- If it has a manual trigger, attempt a test run

**7c. Navigation and general UI**
- Check browser console for JavaScript errors
- Look for broken images or missing assets
- Test org switcher if visible
- Check for unexpected error toasts

### Step 9: Log analysis

Pull logs from the PR environment and analyze:

```bash
bash scripts/pr-test/pr-logs.sh $PR_NUMBER db-migration
bash scripts/pr-test/pr-logs.sh $PR_NUMBER app --errors --lines 200
bash scripts/pr-test/pr-logs.sh $PR_NUMBER scheduler-dispatcher --errors
bash scripts/pr-test/pr-logs.sh $PR_NUMBER event-worker --errors
```

Categorize any errors found:
- **Pre-existing**: errors present before test actions (check timestamps)
- **Test-triggered**: errors caused by test interactions
- **Known/expected**: errors from expected conditions (e.g., missing optional config)

### Step 10: Report

Generate the test report inline using this format:

```
## PR Environment Test Report -- PR #${PR_NUMBER}

**URL**: https://app-pr-${PR_NUMBER}.keeperhub.com
**PR**: <title from Step 4>
**Tested**: <current timestamp>

### Pre-flight
- [PASS/FAIL] Namespace exists
- [PASS/FAIL] All pods healthy
- [PASS/FAIL] DB accessible
- [PASS/FAIL] App URL responding

### Smoke Tests
- [PASS/FAIL] Landing page loads
- [PASS/FAIL] Login with test user
- [PASS/FAIL] Dashboard accessible
- [PASS/FAIL] Workflow canvas renders

### Feature Tests
- [PASS/FAIL] <specific tests based on PR changes>

### Exploratory Tests
- [PASS/FAIL] Workflow creation flow
- [PASS/FAIL] Action grid functional
- [PASS/FAIL] No console errors

### Log Analysis
- [PASS/FAIL] No new application errors
- [PASS/FAIL] No scheduler errors

### Issues Found
<numbered list with severity: Critical / Major / Minor>

### Verdict
[READY TO MERGE / NEEDS FIXES / BLOCKED]
```

### Rules

- ALWAYS run pre-flight (Step 2) before any testing step. Do not skip it.
- ALWAYS use the infrastructure scripts for k8s operations. Do not run raw kubectl commands.
- ALWAYS take screenshots of failures and key states during browser testing.
- ALWAYS read the PR description (Step 5) before feature testing (Step 7).
- Do NOT run the full E2E test suite against the PR environment.
- Do NOT modify the PR environment (no code pushes, no DB migrations, no config changes).
- If a step fails and cannot be resolved quickly, note it in the report and continue to the next step.
- If the environment is completely down (pre-flight fails on namespace or all pods), report and stop.
- Use Playwright MCP for structured browser interactions (clicking, filling forms, navigating).
- Use Claude-in-Chrome for visual inspection (screenshots, reading page content, checking layout).
