---
phase: 21-core-execution-commands
plan: "06"
subsystem: config
tags: [go, config, hosts, yaml, xdg]

requires:
  - phase: 19-cli-scaffold
    provides: XDG-based config path resolution (ConfigFile, HostsFile)
  - phase: 20-auth-and-http-client
    provides: auth commands (login, logout, status) that call ActiveHost

provides:
  - ActiveHost with config.yml fallback: flagHost > envHost > hosts.yml > config.yml > hardcoded default
  - kh config set default_host now affects auth commands without modifying hosts.yml

affects:
  - cmd/auth (login, logout, status all call ActiveHost)
  - 22-power-commands (any command that calls ActiveHost)

tech-stack:
  added: []
  patterns:
    - "Config priority chain: explicit flag > env var > hosts.yml > config.yml > hardcoded default"
    - "Test isolation: set XDG_CONFIG_HOME to t.TempDir() in any test that calls ActiveHost or ReadConfig"

key-files:
  created: []
  modified:
    - internal/config/hosts.go
    - internal/config/hosts_test.go
    - cmd/auth/login_test.go

key-decisions:
  - "ActiveHost checks cfg.DefaultHost != defaultHost before returning config.yml value, preventing the DefaultConfig sentinel ('app.keeperhub.io') from masking the hardcoded fallback when no config file exists"
  - "TestActiveHostFallback and TestLoginCmd_BrowserFlow must set XDG_CONFIG_HOME to isolate from real config.yml on developer machines"

patterns-established:
  - "Test isolation for config-reading functions: always set XDG_CONFIG_HOME to t.TempDir()"

requirements-completed: [WF-03, WF-04, WF-05, RUN-01, RUN-02, RUN-03, RUN-04, EXEC-01, EXEC-02, EXEC-03, EXEC-04, KEY-01, KEY-02, KEY-03]

duration: 8min
completed: "2026-03-13"
---

# Phase 21 Plan 06: Config Host Sync Summary

**ActiveHost now falls back to config.yml default_host so `kh config set default_host X` affects auth commands without requiring hosts.yml modification**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-13T01:09:00Z
- **Completed:** 2026-03-13T01:17:06Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments

- Added config.yml fallback step to `ActiveHost` between hosts.yml and hardcoded default
- Priority chain: flagHost > envHost > hosts.yml DefaultHost > config.yml DefaultHost > "app.keeperhub.io"
- Added three new tests verifying the config.yml fallback behavior
- Fixed test isolation in two existing tests that read from real filesystem

## Task Commits

Each task was committed atomically:

1. **RED: Failing tests for config.yml fallback** - `869bccb` (test)
2. **GREEN: Implementation + test isolation fixes** - `7f96f96` (feat)

## Files Created/Modified

- `internal/config/hosts.go` - ActiveHost extended with config.yml fallback using ReadConfig()
- `internal/config/hosts_test.go` - Added TestActiveHostConfigYMLFallback, TestActiveHostHostsYMLOverridesConfigYML, TestActiveHostFlagOverridesConfigYML; fixed TestActiveHostFallback isolation
- `cmd/auth/login_test.go` - Fixed TestLoginCmd_BrowserFlow to set XDG_CONFIG_HOME temp dir

## Decisions Made

- Used `cfg.DefaultHost != defaultHost` guard in addition to `cfg.DefaultHost != ""` to avoid returning "app.keeperhub.io" via the config.yml path when no config file exists (ReadConfig returns DefaultConfig with that value when file is missing)
- Fixed test isolation as Rule 1 auto-fix: existing tests that omitted XDG_CONFIG_HOME isolation became incorrect once ActiveHost reads from the filesystem

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test isolation: TestActiveHostFallback and TestLoginCmd_BrowserFlow read real config.yml**
- **Found during:** Task 1 (GREEN phase -- running full test suite)
- **Issue:** Two existing tests did not set XDG_CONFIG_HOME. With ActiveHost now calling ReadConfig(), they picked up the developer's real config.yml (which had `localhost:3000`), causing false failures.
- **Fix:** Added `t.Setenv("XDG_CONFIG_HOME", t.TempDir())` to both tests so they run with an empty config directory, getting the hardcoded default.
- **Files modified:** `internal/config/hosts_test.go`, `cmd/auth/login_test.go`
- **Verification:** All 15 config tests and all 10 auth tests pass. Full suite green.
- **Committed in:** `7f96f96` (part of GREEN task commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Necessary correctness fix. Tests that pass on one developer's machine but fail on another's are bugs. No scope creep.

## Issues Encountered

None -- implementation was straightforward once the test isolation problem was identified.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- GAP-02 (config set default_host not affecting auth) is resolved
- Auth commands (login, logout, status) now use the host from `kh config set default_host`
- Priority chain is well-tested and documented; future commands that call ActiveHost inherit the correct behavior automatically

## Self-Check: PASSED

All key files confirmed present. Both task commits verified in git history.

---
*Phase: 21-core-execution-commands*
*Completed: 2026-03-13*
