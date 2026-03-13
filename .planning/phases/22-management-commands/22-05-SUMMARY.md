---
phase: 22-management-commands
plan: 05
subsystem: api
tags: [go, cobra, cli, billing, templates, httptest]

requires:
  - phase: 22-management-commands
    provides: command stubs with flags, Factory DI, output/printer pattern

provides:
  - Template list command: GET /api/workflows/public?featured=true, table NAME/DESCRIPTION/CATEGORY
  - Template deploy command: POST /api/workflows/{id}/duplicate with optional --name override
  - Billing status command: GET /api/billing/subscription with plan/status/usage display
  - Billing usage command: GET /api/billing/subscription with execution count and percentage
  - 404 handling for billing: "Billing is not enabled for this instance."

affects: [22-management-commands, 23-mcp-server]

tech-stack:
  added: []
  patterns:
    - "404-as-feature: billing commands handle 404 with friendly message, not error"
    - "Parent persistent flags: --json and --jq added to template and billing parent commands for test isolation"
    - "truncate helper: package-level function truncates strings to N chars with ... suffix"
    - "categoryFromTags: first publicTag.name or 'General' fallback"

key-files:
  created:
    - cmd/template/list.go
    - cmd/template/deploy.go
    - cmd/template/list_test.go
    - cmd/template/deploy_test.go
    - cmd/billing/status.go
    - cmd/billing/usage.go
    - cmd/billing/status_test.go
    - cmd/billing/usage_test.go
  modified:
    - cmd/template/template.go
    - cmd/billing/billing.go

key-decisions:
  - "template and billing parent commands need --json/--jq persistent flags (same as workflow parent) for test isolation without root command"
  - "Billing 404 returns nil (not error) and prints friendly message to stdout"
  - "deploy sends {} body when no --name, body with {name} when --name provided"
  - "SubscriptionResponse type defined once in status.go, used by both status and usage (same package)"
  - "usage.go skips period query param when value is 'current' (default) to avoid unnecessary query params"

patterns-established:
  - "404-as-feature pattern: check resp.StatusCode == http.StatusNotFound before generic error handling"
  - "Shared type across subcommands: define in the file that most logically owns it, rely on package scope"

requirements-completed: [TMPL-01, TMPL-02, BILL-01, BILL-02]

duration: 3min
completed: 2026-03-13
---

# Phase 22 Plan 05: Template and Billing Commands Summary

**Template list from featured public workflows with description truncation + billing status/usage with graceful 404 handling when billing feature is disabled**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-13T03:49:23Z
- **Completed:** 2026-03-13T03:52:15Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Template list reads featured public workflows as templates; displays NAME, DESCRIPTION (truncated to 50 chars), CATEGORY (first publicTag or "General")
- Template deploy POSTs to /api/workflows/{id}/duplicate; --name flag injects name in body; no confirmation prompt
- Billing status and usage both GET /api/billing/subscription and display plan info or execution counts
- All billing commands handle 404 with "Billing is not enabled for this instance." instead of an error

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement template list and deploy commands** - `497667a` (feat)
2. **Task 2: Implement billing status and usage commands** - `85947a6` (feat)

**Plan metadata:** (docs commit, see below)

_Note: TDD tasks committed as single feat commits (tests + implementation together per GREEN phase)_

## Files Created/Modified

- `cmd/template/list.go` - GET /api/workflows/public?featured=true, table with truncation and category fallback
- `cmd/template/deploy.go` - POST /api/workflows/{id}/duplicate, optional --name body injection
- `cmd/template/template.go` - Added --json/--jq persistent flags
- `cmd/template/list_test.go` - 4 tests: basic call, empty hint, truncation, category from tags
- `cmd/template/deploy_test.go` - 4 tests: method/path, custom name body, empty body, JSON output
- `cmd/billing/billing.go` - Added --json/--jq persistent flags
- `cmd/billing/status.go` - GET subscription, key-value display, 404 handling, SubscriptionResponse type
- `cmd/billing/usage.go` - GET subscription with --period param, execution percentage, 404 handling
- `cmd/billing/status_test.go` - 3 tests: basic call, 404 handling, JSON output
- `cmd/billing/usage_test.go` - 4 tests: basic call, period param, 404 handling, JSON output

## Decisions Made

- Template and billing parent commands need `--json`/`--jq` persistent flags added (same as workflow parent). Root command has them but tests run via parent command, not root. This matches the established pattern from Phase 21.
- `SubscriptionResponse` defined in `status.go` and shared across the billing package (both status and usage share same endpoint/response shape).
- `usage.go` omits `?period=` query param when value is the default `"current"` to avoid unnecessary URL parameters.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added --json/--jq persistent flags to template.go and billing.go**
- **Found during:** Task 1 (TestDeployCmd_JSON failed with "unknown flag: --json")
- **Issue:** Test infrastructure runs commands via parent (template/billing), not root. Root persistent flags are not inherited when parent is used directly in tests.
- **Fix:** Added `cmd.PersistentFlags().Bool("json", ...)` and `cmd.PersistentFlags().String("jq", ...)` to both parent commands, matching the workflow parent pattern from Phase 21.
- **Files modified:** cmd/template/template.go, cmd/billing/billing.go
- **Verification:** TestDeployCmd_JSON and TestStatusCmd_JSON both pass
- **Committed in:** 497667a (Task 1), 85947a6 (Task 2)

---

**Total deviations:** 1 auto-fixed (blocking)
**Impact on plan:** Essential for tests to work; same pattern already established by Phase 21 workflow command. No scope creep.

## Issues Encountered

None beyond the deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Template and billing commands complete. All 8 tests pass.
- Phase 22 management commands continue with remaining stubs.
- Billing 404 pattern is now established and documented for any other optional-feature endpoints.

---
*Phase: 22-management-commands*
*Completed: 2026-03-13*

## Self-Check: PASSED

- cmd/template/list.go: FOUND
- cmd/template/deploy.go: FOUND
- cmd/template/list_test.go: FOUND
- cmd/template/deploy_test.go: FOUND
- cmd/billing/status.go: FOUND
- cmd/billing/usage.go: FOUND
- cmd/billing/status_test.go: FOUND
- cmd/billing/usage_test.go: FOUND
- Commit 497667a: FOUND
- Commit 85947a6: FOUND
