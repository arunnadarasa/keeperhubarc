---
phase: 26-dev-server-lifecycle-and-evaluation-harness
plan: "02"
subsystem: evaluation-harness
tags: [playwright, webServer, evaluation, portless, json-reporter, globalSetup]
dependency_graph:
  requires: [scripts/evaluate/seed-eval.ts, portless-devdep]
  provides: [tests/e2e/playwright/playwright.evaluate.config.ts]
  affects: [26-03-PLAN.md]
tech_stack:
  added: []
  patterns: [evaluation-specific Playwright config, webServer lifecycle management, JSON reporter for machine-readable scoring]
key_files:
  created:
    - tests/e2e/playwright/playwright.evaluate.config.ts
  modified: []
decisions:
  - globalSetup path is ../../../scripts/evaluate/seed-eval.ts (three levels up from tests/e2e/playwright/ to repo root) -- plan spec had incorrect ../../ path
  - retries set to 0 so evaluation failures are real failures, not flake-masked
  - only setup + chromium projects (no inviter/bystander -- evaluation uses primary test user only)
  - portless integration via PORTLESS_AVAILABLE env var check, falling back to port 3099
metrics:
  duration: 8m
  completed: 2026-03-29
  tasks_completed: 1
  files_changed: 1
requirements: [INFRA-01, INFRA-02, INFRA-03]
---

# Phase 26 Plan 02: playwright.evaluate.config.ts evaluation harness config Summary

Playwright evaluation config with webServer lifecycle management (reuseExistingServer: false), JSON reporter to .claude/eval-results.json, globalSetup wired to seed-eval.ts, port 3099 default, and portless integration for named URL assignment in worktrees.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create playwright.evaluate.config.ts | 9ca512fe |

## What Was Built

**tests/e2e/playwright/playwright.evaluate.config.ts:** Evaluation-specific Playwright config that differs from `playwright.config.ts` in three critical ways:

1. `reuseExistingServer: false` -- each evaluation round starts a fresh server with fresh seed data from seed-eval.ts. No state bleed between rounds.

2. `retries: 0` -- failures in autonomous evaluation are real failures, not transient flakes. The evaluator must not mask genuine failures with retries.

3. `reporter: [["json", { outputFile: ".claude/eval-results.json" }]]` -- machine-readable JSON output consumed by Plan 27's scoring scripts.

Additional differences from playwright.config.ts:
- `globalSetup: "../../../scripts/evaluate/seed-eval.ts"` -- seeds test data before each evaluation round
- Port 3099 (avoids collision with developer's running instance on 3000)
- `webServer.timeout: 120_000` -- pnpm dev includes discover-plugins which adds cold-start time
- `trace: "off"` -- no trace overhead during evaluation runs
- Two projects only: `setup` (auth.setup.ts) and `chromium` (primary test user session)
- portless integration: when `PORTLESS_AVAILABLE=1`, wraps dev server with `portless run --name keeperhub` for named URL assignment in worktrees

Satisfies INFRA-01 (webServer lifecycle), INFRA-02/INFRA-03 (portless integration).

## Verification Results

- `grep -c "reuseExistingServer: false"` -- returns 1
- `grep -c "retries: 0"` -- returns 1
- `grep -c "eval-results.json"` -- returns 1
- `grep -c "seed-eval.ts"` -- returns 1
- `grep -c "timeout: 120_000"` -- returns 1
- `grep -c "3099"` -- returns 1
- `playwright test --config ... --list` -- parses config successfully, lists 65 tests across 11 files
- `pnpm type-check` -- passes, no TypeScript errors
- `pnpm check` -- 606 files checked, no fixes applied

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect globalSetup relative path**
- **Found during:** Task 1 verification
- **Issue:** Plan specified `"../../scripts/evaluate/seed-eval.ts"` as the globalSetup path. From `tests/e2e/playwright/`, two levels up (`../..`) resolves to `tests/` not the repo root -- the file would be looked for at `tests/scripts/evaluate/seed-eval.ts` which does not exist.
- **Fix:** Changed to `"../../../scripts/evaluate/seed-eval.ts"` (three levels up: playwright -> e2e -> tests -> repo root -> scripts/evaluate/seed-eval.ts). Verified with Node path.resolve that the corrected path resolves to the existing file.
- **Files modified:** tests/e2e/playwright/playwright.evaluate.config.ts (line 24)
- **Commit:** 9ca512fe (included in task commit)

**Note on --dry-run:** The plan specified `npx playwright test --config ... --dry-run` for verification. Playwright 1.58.2 does not support `--dry-run`. Used `--list` instead, which is the correct equivalent (collects and lists tests without running them). Config validated successfully with `--list`.

**Note on worktree rebase:** The worktree `worktree-agent-ada2f98b` was branched from commit `24fb0fd4` (template base, pre-KeeperHub customizations) and did not have `tests/e2e/playwright/` or `scripts/evaluate/`. Rebased onto `staging` before creating the file so the worktree has the full KeeperHub codebase context.

## Known Stubs

None. The config references real files (seed-eval.ts from Plan 01, auth.setup.ts in tests/e2e/playwright/) and real infrastructure (portless from Plan 01).

## Self-Check: PASSED
