---
phase: 19-cli-scaffold
plan: "02"
subsystem: cli-http-root
tags: [go, cli, http-client, cobra, retryable-http, version-headers]
dependency_graph:
  requires: [go-module, iostreams, factory-di, config-system, hosts-config]
  provides: [retryable-http-client, root-command, global-flags, version-middleware]
  affects: [19-03, 19-04, 19-05]
tech_stack:
  added:
    - github.com/hashicorp/go-retryablehttp (HTTP client with retry/backoff, moved to direct use)
  patterns:
    - Middleware pattern via checkVersion post-response hook
    - Lazy factory evaluation for HTTPClient (reads --host flag after parse)
    - TDD red-green per task
key_files:
  created:
    - /Users/skp/Dev/TechOps Services/cli/internal/http/client.go
    - /Users/skp/Dev/TechOps Services/cli/internal/http/version.go
    - /Users/skp/Dev/TechOps Services/cli/internal/http/errors.go
    - /Users/skp/Dev/TechOps Services/cli/internal/http/client_test.go
    - /Users/skp/Dev/TechOps Services/cli/cmd/root.go
    - /Users/skp/Dev/TechOps Services/cli/cmd/root_test.go
  modified:
    - /Users/skp/Dev/TechOps Services/cli/cmd/kh/main.go
    - /Users/skp/Dev/TechOps Services/cli/pkg/cmdutil/factory.go
decisions:
  - Factory.HTTPClient returns *khhttp.Client (not *http.Client) so callers get version-aware client directly
  - HTTPClient closure captures rootCmd pointer to read --host flag value after Cobra flag parsing
  - SemverLessThan exported for test access; semverLessThan is package-private alias
  - cmd/root.go wires all existing subcommands from plans 03+04 (already committed)
metrics:
  duration_minutes: 4
  completed_date: "2026-03-12"
  tasks_completed: 2
  files_created: 6
---

# Phase 19 Plan 02: HTTP Client and Root Command Summary

Retryable HTTP client with KH-CLI-Version header injection and version compatibility warnings, plus Cobra root command with all 5 global flags (--json, --jq, --yes, --no-color, --host) wired to the full subcommand tree via updated main.go.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Retryable HTTP client with version header middleware | e0f2210 | internal/http/client.go, version.go, errors.go, client_test.go |
| 2 | Root command with global flags and updated main.go | ce6fa75 | cmd/root.go, cmd/root_test.go, cmd/kh/main.go, pkg/cmdutil/factory.go |

## Decisions Made

1. **Factory.HTTPClient returns *khhttp.Client**: Updated `Factory.HTTPClient` from `func() (*http.Client, error)` to `func() (*khhttp.Client, error)`. Commands that need a standard `*http.Client` (e.g. third-party SDK compatibility) can call `client.StandardClient()`. This keeps version-aware behavior without callers having to unwrap.

2. **HTTPClient closure captures rootCmd**: The `HTTPClient` func in main.go uses a forward-declared `*cobra.Command` variable. The closure reads `--host` flag value at call time (after Cobra parses flags), satisfying the priority chain: `--host flag > KH_HOST env > hosts.yml default > built-in default`.

3. **SemverLessThan exported for tests**: The plan specifies `semverLessThan` as package-private, but tests in an external `_test` package cannot access unexported symbols. Added `SemverLessThan` as the exported form; the private `semverLessThan` delegates to it.

4. **Root command wires all existing subcommands**: Plans 03 and 04 were already committed before this plan ran. `cmd/root.go` registers all subcommands (action, apikey, auth, billing, completion, config, doctor, execute, org, project, protocol, run, serve, tag, template, version, wallet, workflow) so the binary is fully functional.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing go.sum entries for testify transitive deps**
- **Found during:** Task 1 RED phase
- **Issue:** `go test` failed with "missing go.sum entry for module providing package github.com/davecgh/go-spew/spew" because testify was in go.mod as indirect but go.sum lacked transitive entries.
- **Fix:** Ran `go get github.com/stretchr/testify/assert@v1.11.1 && go mod tidy` to populate go.sum.
- **Files modified:** go.mod, go.sum
- **Commit:** e0f2210

**2. [Rule 1 - Bug] Plans 03/04 already committed; main.go had inline root command**
- **Found during:** Task 2 implementation
- **Issue:** The existing `cmd/kh/main.go` (from plans 03/04) had an inline `*cobra.Command` root instead of using `cmd.NewRootCmd(f)`. It also lacked HTTPClient wiring.
- **Fix:** Rewrote main.go to use `cmd.NewRootCmd(f)` and added HTTPClient factory func with host resolution logic.
- **Files modified:** cmd/kh/main.go
- **Commit:** ce6fa75

## Verification Results

```
go build ./cmd/kh -- PASS
./kh --help -- shows all 5 global flags (--json, --jq, --yes, --no-color, --host)
./kh -H app-staging.keeperhub.com --help -- PASS (parses without error)
go test ./internal/http/... -v -- PASS (11 tests)
go test ./cmd/... -v -- PASS (12 tests)
go test ./... -- PASS (all packages)
grep -r "func init" cmd/ -- 0 results
grep -r "\.Run = func" cmd/ -- 0 results
```

## Self-Check: PASSED

Files exist:
- /Users/skp/Dev/TechOps Services/cli/internal/http/client.go: FOUND
- /Users/skp/Dev/TechOps Services/cli/internal/http/version.go: FOUND
- /Users/skp/Dev/TechOps Services/cli/internal/http/errors.go: FOUND
- /Users/skp/Dev/TechOps Services/cli/internal/http/client_test.go: FOUND
- /Users/skp/Dev/TechOps Services/cli/cmd/root.go: FOUND
- /Users/skp/Dev/TechOps Services/cli/cmd/root_test.go: FOUND

Commits exist:
- e0f2210: Task 1 HTTP client -- FOUND
- ce6fa75: Task 2 root command -- FOUND
