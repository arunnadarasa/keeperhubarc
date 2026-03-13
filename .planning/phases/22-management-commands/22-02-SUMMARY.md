---
phase: 22-management-commands
plan: "02"
subsystem: cli
tags: [go, cobra, better-auth, org-management, httptest]

requires:
  - phase: 21-core-execution-commands
    provides: HTTP client, output/printer, cmdutil error types, BuildBaseURL, IOStreams patterns
  - phase: 20-auth-and-http-client
    provides: Factory DI, authenticated HTTP client, config system

provides:
  - "kh o ls: GET /api/organizations with NAME/SLUG/ROLE/CREATED table"
  - "kh o switch <slug>: two-step resolve+set-active via Better Auth"
  - "kh o members: POST /api/auth/organization/list-members with NAME/EMAIL/ROLE table"

affects:
  - 22-management-commands (remaining plans may reference org types)

tech-stack:
  added: []
  patterns:
    - "Better Auth POST endpoints: use json.Marshal({}) empty body + Content-Type: application/json"
    - "Two-step slug resolution: GET list to resolve slug->ID, then POST with ID"
    - "Wrapped response shape: Better Auth list-members returns {members: [...]} not bare array"

key-files:
  created:
    - cmd/org/list_test.go
    - cmd/org/switch_test.go
    - cmd/org/members_test.go
  modified:
    - cmd/org/list.go
    - cmd/org/switch.go
    - cmd/org/members.go
    - cmd/org/org.go

key-decisions:
  - "org parent command registers --json/--jq as persistent flags (same as workflow.go) to enable test isolation without root command"
  - "switch confirmation extracts memberCount/plan from org metadata when present; falls back to plain confirmation without parenthetical"
  - "members uses membersResponse wrapper struct to decode {members:[...]} shape from Better Auth list-members"
  - "memberName helper extracts user.name from nested user object, falls back to empty string"

patterns-established:
  - "Pattern: org parent cmd has PersistentFlags for --json/--jq matching workflow cmd pattern"
  - "Pattern: Better Auth endpoints use POST with empty JSON body {}"
  - "Pattern: two-step API calls (list then mutate) within single RunE handler"

requirements-completed: [ORG-01, ORG-02, ORG-03]

duration: 2min
completed: 2026-03-13
---

# Phase 22 Plan 02: Org Management Commands Summary

**org list/switch/members commands using two-step slug resolution and Better Auth POST endpoints with table output**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T03:29:24Z
- **Completed:** 2026-03-13T03:31:09Z
- **Tasks:** 2 (TDD: RED+GREEN per task)
- **Files modified:** 7

## Accomplishments
- `kh o ls` fetches GET /api/organizations and renders NAME/SLUG/ROLE/CREATED table; empty list shows hint
- `kh o switch <slug>` does two-step: resolves slug to ID via org list, then POSTs to /api/auth/organization/set-active; prints confirmation with member count and tier from metadata
- `kh o members` POSTs to /api/auth/organization/list-members (Better Auth endpoint), decodes {members:[...]} wrapper, renders NAME/EMAIL/ROLE table
- 11 tests covering: GET call verification, table columns, empty hints, JSON output, POST method assertion, slug not-found error, confirmation message

## Task Commits

Each task was committed atomically:

1. **Task 1: Org list and switch commands** - `feaa214` (feat)
2. **Task 2: Org members command** - `ead80ff` (feat)

**Plan metadata:** (docs commit to follow)

_Note: TDD tasks have RED (tests) followed by GREEN (implementation) within same commit_

## Files Created/Modified
- `cmd/org/list.go` - Organization struct, GET /api/organizations, table with NAME/SLUG/ROLE/CREATED
- `cmd/org/switch.go` - Two-step slug resolution + set-active POST, confirmation with metadata
- `cmd/org/members.go` - Member struct, POST /api/auth/organization/list-members, NAME/EMAIL/ROLE table
- `cmd/org/org.go` - Added --json/--jq persistent flags for test isolation
- `cmd/org/list_test.go` - 4 tests: GET call, table columns, empty hint, JSON output
- `cmd/org/switch_test.go` - 3 tests: set-active called with ID, confirmation message, not-found error
- `cmd/org/members_test.go` - 4 tests: POST method, table columns, empty hint, JSON output

## Decisions Made
- org parent command registers `--json`/`--jq` as persistent flags (same as workflow.go) to support test isolation when tests instantiate `org.NewOrgCmd(f)` directly without root. Root already has these as persistent flags; the child definition takes precedence in cobra.
- switch confirmation includes `(N members, TIER tier)` only when metadata fields `memberCount` and `plan` are both present; gracefully omits when missing.
- members endpoint decodes `{members: [...]}` wrapper struct (Better Auth response shape) rather than bare array.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Org commands complete (ORG-01, ORG-02, ORG-03)
- Pattern established for Better Auth POST endpoints usable by future auth-adjacent commands
- Ready for remaining phase 22 plans (projects, tags, actions, protocol, wallet, template, billing, doctor)

---
*Phase: 22-management-commands*
*Completed: 2026-03-13*
