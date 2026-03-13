---
phase: 23-mcp-server-mode-docs-testing
plan: 03
subsystem: cli
tags: [cobra, docs, go-generate, integration-tests, ci, github-actions]

requires:
  - phase: 23-mcp-server-mode-docs-testing-02
    provides: Example/Long/See also help text on all 54 commands plus three help topic commands

provides:
  - "docs/generate.go: cobra/doc driver generating markdown command reference with DisableAutoGenTag"
  - "docs/kh*.md: 56 auto-generated command reference files (one per command)"
  - "docs/quickstart.md: hand-written install, auth, common commands, and MCP setup guide"
  - "docs/concepts.md: hand-written KeeperHub overview, auth model, output formats, config, MCP"
  - "README.md: minimal project README with install, auth, common commands, and MCP"
  - "tests/integration/auth_test.go: integration test skeleton for auth flow with //go:build integration"
  - "tests/integration/http_test.go: integration test skeleton for HTTP client with //go:build integration"
  - "CI docs-check job: go generate + git diff --exit-code docs/ on every PR"
  - "CI integration-test job: go test -tags integration on push only"

affects: [phase-24-distribution]

tech-stack:
  added:
    - "github.com/spf13/cobra/doc (GenMarkdownTree for command reference generation)"
    - "github.com/cpuguy83/go-md2man/v2 (transitive dep of cobra/doc)"
  patterns:
    - "docs/generate.go uses //go:build ignore so it never enters the normal build graph"
    - "//go:generate go run generate.go inside docs/generate.go -- run with: cd docs && go generate"
    - "DisableAutoGenTag = true prevents date-based footer causing spurious CI diffs"
    - "Integration tests use //go:build integration to exclude from default go test ./..."
    - "Integration tests skip gracefully with t.Skip when required env vars are absent"

key-files:
  created:
    - docs/generate.go
    - docs/kh.md
    - docs/quickstart.md
    - docs/concepts.md
    - README.md
    - tests/integration/auth_test.go
    - tests/integration/http_test.go
  modified:
    - .github/workflows/ci.yml
    - go.mod
    - go.sum

key-decisions:
  - "cobra/doc is a sub-package of spf13/cobra and requires go get github.com/spf13/cobra/doc to pull in the cpuguy83/go-md2man transitive dep not in the original go.sum"
  - "generate.go output dir is . (docs/) because the //go:generate directive is run via cd docs && go generate; CI mirrors this pattern"
  - "Integration test KH_API_KEY added to CI secrets alongside KH_TEST_EMAIL/PASSWORD for TestHTTPClient* tests that need an API key"

patterns-established:
  - "Docs generation: cd docs && go generate produces all command reference markdown; CI enforces with git diff --exit-code docs/"
  - "Integration tests: //go:build integration tag, t.Skip when env vars absent, testHost() helper reads KH_TEST_HOST with app.keeperhub.io fallback"

requirements-completed: [DOCS-03, DOCS-04, TEST-01, TEST-02, TEST-04]

duration: 4min
completed: 2026-03-13
---

# Phase 23 Plan 03: Docs Generation, Integration Tests, and CI Summary

**cobra/doc-driven command reference (56 files), hand-written quickstart/concepts guides, project README, integration test skeletons for auth and HTTP client, and CI staleness check plus integration test jobs**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-13T05:36:24Z
- **Completed:** 2026-03-13T05:41:05Z
- **Tasks:** 2
- **Files modified:** 62 (57 docs + README + go.mod/sum + ci.yml + 2 integration test files)

## Accomplishments
- Created docs/generate.go with cobra/doc GenMarkdownTree and DisableAutoGenTag; running `cd docs && go generate` produces 56 clean command reference markdown files
- Wrote docs/quickstart.md (78 lines) and docs/concepts.md (60 lines) as hand-written guides covering install, auth, commands, output formats, config, and MCP mode
- Created README.md (55 lines) with install options, auth, 6 common commands, and MCP server mode
- Added tests/integration/auth_test.go and tests/integration/http_test.go with //go:build integration; all tests skip gracefully without credentials
- Extended CI with docs-check job (staleness enforcement) and integration-test job (push-only, uses repository secrets)

## Task Commits

Each task was committed atomically:

1. **Task 1: Docs generation, hand-written guides, and README** - `bcee669` (docs)
2. **Task 2: Integration test skeletons and CI pipeline updates** - `74cb7e8` (feat)

## Files Created/Modified
- `docs/generate.go` - cobra/doc driver with //go:build ignore and //go:generate directive
- `docs/kh*.md` (56 files) - auto-generated command reference markdown
- `docs/quickstart.md` - install, auth, common commands, MCP setup
- `docs/concepts.md` - KeeperHub overview, auth model, output formats, config, MCP
- `README.md` - minimal project README
- `tests/integration/auth_test.go` - TestAuthLoginFlow, TestAuthStatus with build tag
- `tests/integration/http_test.go` - TestHTTPClientRetry, TestHTTPClientVersionHeader with build tag
- `.github/workflows/ci.yml` - added docs-check and integration-test jobs
- `go.mod`, `go.sum` - added cobra/doc transitive dependency

## Decisions Made
- cobra/doc sub-package not in original go.sum; ran `go get github.com/spf13/cobra/doc` to add cpuguy83/go-md2man transitive dep
- generate.go outputs to `.` (the docs/ dir) because the `//go:generate` directive is meant to be run as `cd docs && go generate`; CI mirrors this exact pattern
- Added `KH_API_KEY` env to CI integration-test job alongside `KH_TEST_EMAIL/PASSWORD` since TestHTTPClient* tests authenticate via API key

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added cobra/doc transitive dependency to go.sum**
- **Found during:** Task 1 (running docs/generate.go)
- **Issue:** `go run docs/generate.go` failed with "missing go.sum entry for github.com/cpuguy83/go-md2man/v2"; this package is required by cobra/doc but not in the original go.sum
- **Fix:** Ran `go get github.com/spf13/cobra/doc@v1.10.0` which added the transitive dep to go.mod and go.sum
- **Files modified:** go.mod, go.sum
- **Verification:** `go run docs/generate.go` succeeded and produced 56 markdown files
- **Committed in:** bcee669 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking missing dependency)
**Impact on plan:** Necessary correctness fix to pull in cobra/doc's transitive dep. No scope creep.

## Issues Encountered
None beyond the cobra/doc transitive dependency, which was auto-fixed inline.

## User Setup Required
None - no external service configuration required. Integration tests skip gracefully when credentials are absent.

## Next Phase Readiness
- docs/ complete with generated command reference and hand-written guides
- CI enforces docs staleness on every PR
- Integration test infrastructure ready; actual tests run on push when KH_API_KEY/KH_TEST_* secrets are configured
- Ready for Phase 24 (Distribution and Release)

## Self-Check: PASSED
- docs/generate.go: FOUND
- docs/quickstart.md: FOUND
- docs/concepts.md: FOUND
- README.md: FOUND
- tests/integration/auth_test.go: FOUND
- tests/integration/http_test.go: FOUND
- Commit bcee669 (Task 1): FOUND
- Commit 74cb7e8 (Task 2): FOUND

---
*Phase: 23-mcp-server-mode-docs-testing*
*Completed: 2026-03-13*
