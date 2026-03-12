---
phase: 19-cli-scaffold
plan: "05"
subsystem: infra
tags: [go, cobra, goreleaser, golangci-lint, github-actions, makefile, testing]

requires:
  - phase: 19-cli-scaffold (plans 01-04)
    provides: command stubs, HTTP client, config system, IOStreams, Factory, all 18 command packages

provides:
  - Expanded root_test.go with 18-subcommand count, help output, all 14 alias resolution, Short invariant tests
  - workflow_test.go testing subcommand count, aliases, flags, and stub output via ls alias chain
  - .goreleaser.yaml with CGO_ENABLED=0, linux/darwin/windows amd64+arm64, version ldflags injection
  - .golangci.yml golangci-lint v2 config with standard linters
  - .github/workflows/ci.yml with lint and test jobs including CGO_ENABLED=0 build verification
  - Makefile with build, test, lint, clean, install targets
  - Fully verified kh binary: version, wf ls, --help, zero structural violations

affects: [20-auth, 21-commands, 22-power-features, 23-mcp, 24-distribution]

tech-stack:
  added: [goreleaser v2, golangci-lint v2, github-actions]
  patterns: [per-task atomic commits, CGO_ENABLED=0 static binary, CI-first workflow]

key-files:
  created:
    - cmd/workflow/workflow_test.go
    - .goreleaser.yaml
    - .golangci.yml
    - .github/workflows/ci.yml
    - Makefile
  modified:
    - cmd/root_test.go

key-decisions:
  - "api-key is the cobra Use name (not apikey) -- test checks api-key in help output"
  - "Task 3 was verification-only: all structural invariants passed without any file changes"
  - "macOS binary links libSystem/libresolv/Security -- expected behavior with CGO_ENABLED=0 on macOS, Linux builds are fully static"

patterns-established:
  - "All 18 commands registered in root.go alphabetically by package name"
  - "Alias tests use SetArgs([alias, --help]) pattern for alias resolution verification"
  - "Workflow tests capture IOStreams buffer directly to verify stub output"

requirements-completed:
  - FOUND-11
  - HTTP-04

duration: 15min
completed: 2026-03-13
---

# Phase 19 Plan 05: Final Assembly Summary

**kh binary fully wired with 18 commands, all 14 noun aliases verified, CGO_ENABLED=0 static build, GitHub Actions CI, GoReleaser, golangci-lint, and Makefile -- Phase 19 CLI scaffold complete**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-13T00:00:00Z
- **Completed:** 2026-03-13T00:15:00Z
- **Tasks:** 3 (2 with file changes, 1 verification-only)
- **Files modified:** 6

## Accomplishments

- Expanded integration tests: 18-subcommand count, all commands in --help, all 14 noun aliases (wf, r, ex, p, t, ak, o, a, pr, w, tp, b, doc, v) resolve without error
- workflow_test.go: 5-subcommand count, wf alias, ls alias, --wait flag, --limit flag, ls alias chain prints "not yet implemented"
- CI/CD toolchain: .goreleaser.yaml, .golangci.yml, .github/workflows/ci.yml (lint + test jobs), Makefile
- Final verification: kh version, kh wf ls, kh --help, go vet, no init(), no .Run, no os.Exit outside main.go, no log.Fatal

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire all commands and add integration tests** - `fa54bbb` (feat)
2. **Task 2: CI pipeline, GoReleaser, golangci-lint, and Makefile** - `05217c5` (chore)
3. **Task 3: Final verification** - no commit (verification-only, zero file changes)

## Files Created/Modified

- `cmd/root_test.go` - Expanded with 18-subcommand count, help output, alias resolution, Short invariant tests
- `cmd/workflow/workflow_test.go` - New: subcommand count, alias, flag, and stub output tests
- `.goreleaser.yaml` - GoReleaser v2 config with CGO_ENABLED=0, multi-platform builds
- `.golangci.yml` - golangci-lint v2 with standard linters, errcheck excluded from tests
- `.github/workflows/ci.yml` - CI with lint and test jobs, CGO_ENABLED=0 build verification
- `Makefile` - build, test, lint, clean, install targets with version ldflags injection

## Decisions Made

- `api-key` is the cobra Use name for the API key command (not `apikey`) -- the help output and test check for `api-key`
- Task 3 was purely verification -- all structural invariants (no init, no Run, no os.Exit, no log.Fatal) passed with zero fixes needed
- macOS `otool -L` shows libSystem/libresolv/Security -- expected on macOS with CGO_ENABLED=0 due to Go's net package; Linux CI builds are fully static

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed help output test checking wrong command name**
- **Found during:** Task 1 (integration test implementation)
- **Issue:** Test checked for "apikey" in help output but the command is registered as "api-key" (Use: "api-key" in apikey.go)
- **Fix:** Changed expected string from "apikey" to "api-key" in TestRootCmdHelpIncludesAllCommands
- **Files modified:** cmd/root_test.go
- **Verification:** go test ./cmd/... passes
- **Committed in:** fa54bbb (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test assertion)
**Impact on plan:** Minor test correction, no scope creep.

## Issues Encountered

- First workflow_test.go draft used `ios.SetStdoutTTY()` which doesn't exist on IOStreams -- fixed by using `iostreams.Test()` buffer directly and dropping the unused method call

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 19 CLI scaffold is complete: all 18 commands wired, aliases verified, CGO_ENABLED=0 build passing, CI config committed
- Phase 20 (auth) can begin: Factory, HTTPClient, IOStreams, and config system are all available
- GoReleaser ready for distribution once auth and commands are implemented

---
*Phase: 19-cli-scaffold*
*Completed: 2026-03-13*
