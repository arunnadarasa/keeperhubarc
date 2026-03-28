---
phase: 26-dev-server-lifecycle-and-evaluation-harness
plan: "01"
subsystem: evaluation-harness
tags: [portless, seed, evaluation, playwright, globalSetup]
dependency_graph:
  requires: []
  provides: [scripts/evaluate/seed-eval.ts, portless-devdep]
  affects: [26-02-PLAN.md]
tech_stack:
  added: [portless@0.7.2]
  patterns: [globalSetup-compatible async export, dotenv-expand pattern, FK-safe cleanup+seed order]
key_files:
  created:
    - scripts/evaluate/seed-eval.ts
  modified:
    - package.json
    - pnpm-lock.yaml
decisions:
  - portless installed as devDependency using CLI flags (--name), no config file needed
  - seed-eval.ts uses same dotenv/dotenv-expand pattern as global-setup.ts
  - DATABASE_URL fallback to localhost:5433 matches existing global-setup.ts default
metrics:
  duration: 2m
  completed: 2026-03-29
  tasks_completed: 2
  files_changed: 3
requirements: [INFRA-02, INFRA-03, INFRA-04]
---

# Phase 26 Plan 01: portless installation and seed-eval wrapper Summary

portless installed as devDependency and seed-eval.ts created as a Playwright-compatible globalSetup wrapper that runs cleanup + seed in FK-safe order for evaluation rounds.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Install portless dev dependency | 66aefef0 |
| 2 | Create scripts/evaluate/seed-eval.ts | a5479dfa |

## What Was Built

**portless (package.json devDependencies):** portless 0.7.2 enables named `.localhost` subdomain management. When run as `portless run --name keeperhub pnpm dev`, it assigns `http://keeperhub.localhost:<port>` and injects `PORTLESS_URL` and `PORT` env vars. In git worktrees, the branch name auto-prepends as a subdomain prefix, satisfying INFRA-02 and INFRA-03.

**scripts/evaluate/seed-eval.ts:** A Playwright globalSetup-compatible async function that:
1. Expands dotenv vars via dotenv-expand
2. Sets DATABASE_URL fallback to `postgresql://postgres:postgres@localhost:5433/keeperhub` if unset or unexpanded
3. Runs cleanup + seed in FK-safe order: cleanupTestUsers, cleanupPersistentTestUsers, seedPersistentTestUsers, seedAnalyticsData
4. Logs `[seed-eval] Seed complete` on success
5. Exports as `default` for Playwright globalSetup consumption

Satisfies INFRA-04. This file is referenced as `globalSetup` in playwright.evaluate.config.ts (Plan 02).

## Verification Results

- `grep '"portless"' package.json` -- match found
- `npx portless --version` -- exits 0, prints 0.7.2
- `ls scripts/evaluate/seed-eval.ts` -- file exists
- `pnpm type-check` -- passes, no errors in seed-eval.ts
- `pnpm check` -- passes, 606 files checked, no fixes applied

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. seed-eval.ts imports are wired to real test utility functions in tests/e2e/playwright/utils/.

## Self-Check: PASSED
