---
phase: 21-core-execution-commands
plan: 05
subsystem: api
tags: [go, http, url, cli, refactoring]

requires:
  - phase: 21-core-execution-commands
    provides: workflow, execute, and run commands with raw host URL concatenation

provides:
  - "BuildBaseURL shared utility in internal/http/url.go handles bare hostname and scheme-prefixed host strings"
  - "All 10 command/auth files use BuildBaseURL for URL construction"
  - "localhost:3000 and other bare hosts work without unsupported protocol scheme error"

affects: [phase-22, phase-23, any future CLI command that constructs API URLs]

tech-stack:
  added: []
  patterns:
    - "URL normalisation through khhttp.BuildBaseURL: single entry point for scheme injection and trailing-slash trimming"

key-files:
  created:
    - internal/http/url.go
    - internal/http/url_test.go
  modified:
    - cmd/run/status.go
    - cmd/run/cancel.go
    - cmd/run/logs.go
    - cmd/workflow/list.go
    - cmd/workflow/get.go
    - cmd/workflow/go_live.go
    - cmd/workflow/pause.go
    - cmd/workflow/run.go
    - cmd/execute/transfer.go
    - cmd/execute/contract_call.go
    - internal/auth/oauth.go
    - internal/auth/device.go
    - internal/auth/token.go

key-decisions:
  - "BuildBaseURL exported from internal/http package (same package as Client) so all command layers can import one place"
  - "Trailing slash stripped in BuildBaseURL to prevent double-slash in constructed URLs"
  - "http:// scheme preserved as-is so local dev with non-TLS server works without workarounds"

patterns-established:
  - "URL construction pattern: khhttp.BuildBaseURL(host) + /api/path for every command file"

requirements-completed: [WF-01, WF-02, WF-03, WF-04, WF-05, WF-06, RUN-01, EXEC-01, EXEC-02, EXEC-03]

duration: 3min
completed: 2026-03-13
---

# Phase 21 Plan 05: URL Scheme Fix Summary

**Shared BuildBaseURL utility in internal/http/url.go replaces 13 instances of raw host concatenation across all CLI command and auth files, fixing the unsupported protocol scheme error for bare hostnames**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-13T01:15:06Z
- **Completed:** 2026-03-13T01:18:15Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- Created `internal/http/url.go` with exported `BuildBaseURL` covering 6 edge cases (bare hostname, http://, https://, bare domain, trailing slash variants)
- Updated all 10 command files (workflow/list, get, go_live, pause, run; execute/transfer, contract_call; run/status, cancel, logs) to use `khhttp.BuildBaseURL`
- Updated 3 auth files (oauth, device, token) replacing hardcoded `"https://"+host` concatenation
- Full test suite: 0 failures across all packages

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract BuildBaseURL to internal/http/url.go with tests** - `07f328a` (feat)
2. **Task 2: Apply BuildBaseURL to all workflow and execute commands plus auth files** - `1d19b1e` (feat)

## Files Created/Modified
- `internal/http/url.go` - Exported BuildBaseURL: prepends https:// if no scheme, strips trailing slash
- `internal/http/url_test.go` - 6 table-driven test cases covering all edge cases
- `cmd/run/status.go` - Removed local buildBaseURL function; uses khhttp.BuildBaseURL
- `cmd/run/cancel.go` - Added khhttp import; uses khhttp.BuildBaseURL
- `cmd/run/logs.go` - Added khhttp import; uses khhttp.BuildBaseURL
- `cmd/workflow/list.go` - Uses khhttp.BuildBaseURL (import already present)
- `cmd/workflow/get.go` - Uses khhttp.BuildBaseURL (import already present)
- `cmd/workflow/go_live.go` - Uses khhttp.BuildBaseURL (import already present)
- `cmd/workflow/pause.go` - Uses khhttp.BuildBaseURL (import already present)
- `cmd/workflow/run.go` - Uses khhttp.BuildBaseURL in both execURL and fetchStatus (import already present)
- `cmd/execute/transfer.go` - Uses khhttp.BuildBaseURL in both transfer POST and fetchExecStatus (import already present)
- `cmd/execute/contract_call.go` - Uses khhttp.BuildBaseURL (import already present)
- `internal/auth/oauth.go` - Added khhttp import; fmt.Sprintf %s now uses BuildBaseURL(host)
- `internal/auth/device.go` - Added khhttp import; both device/code and device/token URLs updated
- `internal/auth/token.go` - Added khhttp import; both get-session and organizations URLs updated

## Decisions Made
- BuildBaseURL placed in `internal/http` (same package as Client) to avoid a new package and keep URL logic with the HTTP layer
- Trailing slash stripped unconditionally so callers never produce `host//api/path` double-slash URLs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed cmd/run/cancel.go and cmd/run/logs.go using removed buildBaseURL**
- **Found during:** Task 1 (after removing local buildBaseURL from status.go)
- **Issue:** cancel.go and logs.go both called `buildBaseURL(host)` which was defined in status.go; removing it broke the package build
- **Fix:** Added `khhttp "github.com/keeperhub/cli/internal/http"` import and replaced `buildBaseURL(host)` with `khhttp.BuildBaseURL(host)` in both files
- **Files modified:** cmd/run/cancel.go, cmd/run/logs.go
- **Verification:** `go test ./cmd/run/... -timeout 30s` passes
- **Committed in:** 07f328a (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix was essential; the plan only listed status.go as the file to modify in cmd/run but cancel.go and logs.go also used the package-level function. No scope creep.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- URL scheme fix complete; all CLI commands correctly handle bare hostnames like `localhost:3000`
- GAP-01 blocker resolved -- Phase 21 commands are now fully usable against local dev servers
- No blockers for subsequent phases

## Self-Check: PASSED
- `internal/http/url.go` exists: FOUND
- `internal/http/url_test.go` exists: FOUND
- Commit `07f328a` exists: FOUND
- Commit `1d19b1e` exists: FOUND

---
*Phase: 21-core-execution-commands*
*Completed: 2026-03-13*
