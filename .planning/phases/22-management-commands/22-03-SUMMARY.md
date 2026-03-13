---
phase: 22-management-commands
plan: 03
subsystem: cli
tags: [go, cache, xdg, protocols, schemas]

requires:
  - phase: 21-core-execution-commands
    provides: internal/http package with BuildBaseURL, khhttp.Client, and NewAPIError

provides:
  - internal/cache package with ReadCache, WriteCache, WriteRaw, IsStale, CacheDir (XDG_CACHE_HOME)
  - ProtocolCacheName and ProtocolCacheTTL constants
  - kh pr ls: protocol list with 1hr cache and --refresh bypass
  - kh pr get <slug>: full reference card with actions and fields

affects:
  - 22-management-commands (other plans can use internal/cache for caching)
  - 23-mcp-server (stable /api/mcp/schemas schema contract)

tech-stack:
  added: []
  patterns:
    - XDG_CACHE_HOME pattern mirroring internal/config XDG_CONFIG_HOME approach
    - Cache-first strategy with stale-while-error fallback
    - WriteRaw helper for test injection of aged cache entries

key-files:
  created:
    - internal/cache/cache.go
    - internal/cache/cache_test.go
    - cmd/protocol/list_test.go
    - cmd/protocol/get_test.go
  modified:
    - cmd/protocol/list.go
    - cmd/protocol/get.go

key-decisions:
  - "WriteRaw added to cache package to allow tests to inject pre-aged CacheEntry bytes without going through WriteCache's time.Now() call"
  - "loadProtocols shared between list and get commands to avoid duplicating the cache-first fetch logic"
  - "renderProtocolDetail uses fmt.Fprintf calls (not a single table) for the reference card layout per plan spec"
  - "printFieldsTable creates its own go-pretty table for action fields sub-rendering"

patterns-established:
  - "Cache package pattern: XDG_CACHE_HOME env var checked first, fallback to ~/.cache/kh"
  - "Stale-while-error: serve stale cache with stderr Warning when API call fails but cache exists"
  - "t.Setenv('XDG_CACHE_HOME', t.TempDir()) for full cache isolation in every test"

requirements-completed: [PROTO-01, PROTO-02, PROTO-03]

duration: 4min
completed: 2026-03-13
---

# Phase 22 Plan 03: Cache Infrastructure and Protocol Discovery Commands Summary

**Reusable XDG cache package plus kh pr ls (1hr TTL, --refresh) and kh pr get (full reference card) backed by /api/mcp/schemas**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-13T03:49:26Z
- **Completed:** 2026-03-13T03:53:38Z
- **Tasks:** 2 (4 commits via TDD RED/GREEN cycles)
- **Files modified:** 6

## Accomplishments

- Created `internal/cache` package with XDG_CACHE_HOME support, ReadCache/WriteCache/IsStale helpers, and WriteRaw for test injection of aged entries
- Implemented `kh pr ls` with 1hr cache-first strategy, --refresh bypass, stale-while-error fallback with stderr warning
- Implemented `kh pr get <slug>` with full reference card rendering (name, description, actions with field tables)

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Cache infrastructure tests** - `1667c0b` (test)
2. **Task 1 GREEN: Cache infrastructure implementation** - `6ded9a3` (feat)
3. **Task 2 RED: Protocol list and get tests** - `114fc28` (test)
4. **Task 2 GREEN: Protocol list and get implementation** - `5f7a5cf` (feat)

_Note: TDD tasks have separate RED and GREEN commits_

## Files Created/Modified

- `internal/cache/cache.go` - CacheDir, ReadCache, WriteCache, WriteRaw, IsStale with XDG support
- `internal/cache/cache_test.go` - 7 tests covering all cache operations
- `cmd/protocol/list.go` - Protocol list command with cache logic, SchemasResponse/Protocol/Action/Field types
- `cmd/protocol/get.go` - Protocol get command with reference card renderer
- `cmd/protocol/list_test.go` - 6 tests covering cache miss/hit/refresh/stale/error scenarios
- `cmd/protocol/get_test.go` - 2 tests covering found and not-found cases

## Decisions Made

- Added `WriteRaw` to cache package (deviation Rule 2 - missing critical functionality for tests): tests need to inject a pre-aged CacheEntry with a specific FetchedAt timestamp to test the stale-while-error path. WriteCache always uses time.Now(), so WriteRaw lets tests write raw bytes directly.
- Shared `loadProtocols` helper between list.go and get.go to avoid duplicating the cache-first fetch logic.
- `renderProtocolDetail` uses `fmt.Fprintf` calls per plan spec (not a single table), giving a readable reference card format.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added WriteRaw to cache package**
- **Found during:** Task 2 (writing TestListCmd_StaleWithError test)
- **Issue:** TestListCmd_StaleWithError requires a cache entry with a FetchedAt 2 hours in the past. WriteCache always stamps time.Now() so there was no way to inject an aged entry.
- **Fix:** Added WriteRaw(name string, b []byte) error to cache package. Tests marshal a CacheEntry struct with FetchedAt set to time.Now().Add(-2*time.Hour) then call WriteRaw with the bytes.
- **Files modified:** internal/cache/cache.go
- **Verification:** TestListCmd_StaleWithError passes, cache_test.go still passes
- **Committed in:** 114fc28 (Task 2 RED commit, as part of adding the cache export needed for tests)

---

**Total deviations:** 1 auto-fixed (missing critical test utility)
**Impact on plan:** WriteRaw is a minimal addition that enables full test coverage of the stale path. No scope creep.

## Issues Encountered

- TestListCmd_StaleWithError and TestListCmd_NoCacheWithError each take ~7 seconds due to the khhttp retry logic when the test server returns 500. This is expected behavior (the retryable HTTP client is working as designed) and does not affect correctness.

## Next Phase Readiness

- `internal/cache` is available as a reusable package for any future commands that need caching
- Protocol types (Protocol, Action, Field) defined in cmd/protocol/list.go are available for reference
- All 15 tests across both packages pass

## Self-Check: PASSED

- internal/cache/cache.go: FOUND
- internal/cache/cache_test.go: FOUND
- cmd/protocol/list.go: FOUND
- cmd/protocol/get.go: FOUND
- cmd/protocol/list_test.go: FOUND
- cmd/protocol/get_test.go: FOUND
- Commit 1667c0b: FOUND
- Commit 6ded9a3: FOUND
- Commit 114fc28: FOUND
- Commit 5f7a5cf: FOUND

---
*Phase: 22-management-commands*
*Completed: 2026-03-13*
