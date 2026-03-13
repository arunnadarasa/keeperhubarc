---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: milestone
status: planning
stopped_at: Completed 21-core-execution-commands/21-01-PLAN.md
last_updated: "2026-03-13T00:29:34.500Z"
last_activity: 2026-03-13 -- Phase 19 (CLI Scaffold) executed and verified, 5/5 plans complete
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 13
  completed_plans: 13
  percent: 17
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** Users can build and deploy Web3 automation workflows through a visual builder without writing code.
**Current focus:** v1.5 KeeperHub CLI -- Phase 20 (Auth and HTTP Client)

## Current Position

Phase: 20 of 24 (Auth and HTTP Client)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: 2026-03-13 -- Phase 19 (CLI Scaffold) executed and verified, 5/5 plans complete

Progress: [████░░░░░░░░░░░░░░░░] 17% (1/6 phases complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 5 (v1.5)
- Average duration: ~7 min
- Total execution time: ~25 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 19-cli-scaffold | 5/5 | ~25 min | ~5 min |

*Updated after each plan completion*
| Phase 19-cli-scaffold P01 | 7 | 2 tasks | 13 files |
| Phase 19-cli-scaffold P04 | 3 | 2 tasks | 33 files |
| Phase 19-cli-scaffold P03 | 7 | 2 tasks | 28 files |
| Phase 19-cli-scaffold P02 | 4 | 2 tasks | 8 files |
| Phase 19-cli-scaffold P05 | 15 | 3 tasks | 6 files |
| Phase 20-auth-and-http-client P01 | 2 | 2 tasks | 3 files |
| Phase 20-auth-and-http-client P03 | 12 | 2 tasks | 11 files |
| Phase 20-auth-and-http-client P04 | 8 | 2 tasks | 10 files |
| Phase 21-core-execution-commands P02 | 6 | 2 tasks | 7 files |
| Phase 21-core-execution-commands P03 | 7 | 2 tasks | 6 files |
| Phase 21-core-execution-commands P04 | 7 | 2 tasks | 6 files |
| Phase 21-core-execution-commands P01 | 15 | 2 tasks | 9 files |

## Accumulated Context

### Decisions

- v1.5 CLI lives in a new standalone repo (keeperhub/cli), separate from the Next.js monorepo
- HTTP client lives in Phase 19 (scaffold) with Auth in Phase 20 -- HTTP is Foundation infrastructure
- Output flags (--json, --jq, --dry-run, --yes, --limit) assigned to Phase 20 to establish the output contract before any commands are written
- Granularity: coarse -- 6 phases justified by hard dependencies (Foundation -> Auth -> Commands -> Power -> MCP -> Dist)
- Use 99designs/keyring (not zalando/go-keyring) per research pitfall on macOS security-level
- Use modelcontextprotocol/go-sdk v1.4.0 (not mark3labs/mcp-go)
- MCP stdout isolation must be the first commit of Phase 23, before any tools are implemented
- [Phase 19]: XDG path resolution uses os.Getenv directly (not adrg/xdg) so t.Setenv() works in tests
- [Phase 19]: CLI repo created at /Users/skp/Dev/TechOps Services/cli as sibling to keeperhub Next.js repo
- [Phase 19]: Factory.HTTPClient returns *khhttp.Client for version-aware requests; callers use StandardClient() for net/http compat
- [Phase 19]: api-key is the cobra Use name (not apikey)
- [Phase 19]: macOS binary links libSystem/libresolv/Security with CGO_ENABLED=0 -- expected, Linux CI is fully static
- [Phase 20-auth-and-http-client]: deviceAuthorization uses TimeString format (15m, 5s) not numeric seconds
- [Phase 20-auth-and-http-client]: Better Auth deviceCode table created at runtime via internal schema management, not drizzle-kit push
- [Phase 20-auth-and-http-client]: go-pretty header rendering uppercases text by default; tests must accept NAME or Name
- [Phase 20-auth-and-http-client]: ApplyJQFilter returns single value directly when jq produces exactly one result, slice otherwise
- [Phase 20-auth-and-http-client]: FileBackend Remove returns os.ErrNotExist (not keyring.ErrKeyNotFound) -- DeleteToken checks both
- [Phase 20-auth-and-http-client]: browserOpener global must be set before BrowserLogin goroutine to avoid race; tests use channel-based capture
- [Phase 20-auth-and-http-client]: Injectable function vars in cmd/auth package for testability (BrowserLoginFunc, DeviceLoginFunc, etc.) -- no mocking framework needed
- [Phase 21-core-execution-commands]: --json and --jq added as persistent flags on NewWorkflowCmd for proper test isolation without root command
- [Phase 21-core-execution-commands]: pause --yes flag defined locally so tests can pass it via workflow parent command
- [Phase 21-core-execution-commands]: runWaitLoop polls immediately then sleeps to avoid 2s initial delay in tests
- [Phase 21-core-execution-commands]: buildBaseURL helper in run package: if host already has http:// or https:// scheme, use as-is; otherwise prepend https://
- [Phase 21-core-execution-commands]: Watch mode has no timeout -- --watch is purely observational; user presses Ctrl+C (distinct from --wait on wf run which blocks)
- [Phase 21-core-execution-commands]: Cancel --yes flag not redefined locally -- inherited as persistent flag from root; local definition removed to avoid cobra panic on flag shadowing
- [Phase 21-core-execution-commands]: Cancel URL is /api/executions/{id}/cancel (NOT /api/workflows/executions/...); different URL pattern from status/logs endpoints
- [Phase 21-core-execution-commands]: --args changed from StringSlice to String: cobra CSV parsing breaks JSON array input
- [Phase 21-core-execution-commands]: Read/write detection by HTTP status: 200=read-only result, 202=write with executionId
- [Phase 21-core-execution-commands]: ExecStatusResponse exported from status.go for shared use by transfer and status commands
- [Phase 21-core-execution-commands]: Removed --status flag from list.go: API has no server-side status filter; status derived client-side from enabled field
- [Phase 21-core-execution-commands]: ApplyJQFilter normalizes typed Go structs via JSON round-trip before gojq to prevent panic on typed slices/structs

### Pending Todos

None yet.

### Blockers/Concerns

- Research flag: Confirm whether KeeperHub's Better Auth supports Device Authorization Grant (RFC 8628) before Phase 20 implementation. If not, a server-side change is needed first.
- Research flag: Verify /api/execute/* request field names at v1.5 before defining CLI flag names in Phase 21.
- Research flag: Confirm /api/mcp/schemas response shape is a stable versioned contract before Phase 23 builds dynamic tool registration.

## Session Continuity

Last session: 2026-03-13T00:29:34.497Z
Stopped at: Completed 21-core-execution-commands/21-01-PLAN.md
Resume file: None
