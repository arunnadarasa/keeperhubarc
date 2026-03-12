---
phase: 19-cli-scaffold
plan: "04"
subsystem: cli
tags: [go, cobra, cli, stub-commands]

requires:
  - phase: 19-01
    provides: Factory, IOStreams, config system, module scaffold

provides:
  - project command group (alias p) with list, create, get, delete subcommands
  - tag command group (alias t) with list, create, get, delete subcommands
  - api-key command group (alias ak) with list, create, revoke subcommands
  - org command group (alias o) with list, switch, members subcommands
  - action command group (alias a) with list, get subcommands
  - protocol command group (alias pr) with list, get subcommands
  - wallet command group (alias w) with balance, tokens subcommands
  - template command group (alias tp) with list, deploy subcommands
  - billing command group (alias b) with status, usage subcommands

affects: [19-05, 19-06, phase-20, phase-21]

tech-stack:
  added: []
  patterns:
    - "Noun command groups use NewXxxCmd(f *cmdutil.Factory) pattern"
    - "All stubs use RunE and print [noun verb] is not yet implemented."
    - "No init() functions in any cmd/ package"
    - "Required flags marked with cmd.MarkFlagRequired"

key-files:
  created:
    - cmd/project/project.go
    - cmd/project/list.go
    - cmd/project/create.go
    - cmd/project/get.go
    - cmd/project/delete.go
    - cmd/tag/tag.go
    - cmd/tag/list.go
    - cmd/tag/create.go
    - cmd/tag/get.go
    - cmd/tag/delete.go
    - cmd/apikey/apikey.go
    - cmd/apikey/list.go
    - cmd/apikey/create.go
    - cmd/apikey/revoke.go
    - cmd/org/org.go
    - cmd/org/list.go
    - cmd/org/switch.go
    - cmd/org/members.go
    - cmd/action/action.go
    - cmd/action/list.go
    - cmd/action/get.go
    - cmd/protocol/protocol.go
    - cmd/protocol/list.go
    - cmd/protocol/get.go
    - cmd/wallet/wallet.go
    - cmd/wallet/balance.go
    - cmd/wallet/tokens.go
    - cmd/template/template.go
    - cmd/template/list.go
    - cmd/template/deploy.go
    - cmd/billing/billing.go
    - cmd/billing/status.go
    - cmd/billing/usage.go
  modified: []

key-decisions:
  - "No decisions beyond plan spec -- all stubs follow exact pattern from plan"

patterns-established:
  - "Noun command files: NewXxxCmd registers subcommands and returns root cobra.Command"
  - "Verb stub files: RunE prints [noun verb] is not yet implemented. and returns nil"
  - "Flags declared inline in stub constructors, required flags use MarkFlagRequired"

requirements-completed: [FOUND-07, FOUND-08, FOUND-09, FOUND-10]

duration: 3min
completed: 2026-03-12
---

# Phase 19 Plan 04: Management Command Stubs Summary

**9 management noun command groups (32 files) with full alias and stub subcommand tree covering project, tag, api-key, org, action, protocol, wallet, template, and billing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-12T21:29:52Z
- **Completed:** 2026-03-12T21:32:36Z
- **Tasks:** 2
- **Files modified:** 33

## Accomplishments

- Created all 9 management noun command groups with correct cobra aliases
- Created 23 verb subcommand stubs across all noun groups
- Zero init() functions, all commands use RunE exclusively
- All packages build cleanly with go build

## Task Commits

Each task was committed atomically:

1. **Task 1: Project, tag, api-key, and org command groups** - `fd1a84a` (feat)
2. **Task 2: Action, protocol, wallet, template, and billing command groups** - `68be55c` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `cmd/project/project.go` - Project noun command (alias p), registers list/create/get/delete
- `cmd/project/list.go` - List projects stub with --limit flag
- `cmd/project/create.go` - Create project stub with --name (required), --description flags
- `cmd/project/get.go` - Get project stub, requires 1 arg
- `cmd/project/delete.go` - Delete project stub with --yes flag
- `cmd/tag/tag.go` - Tag noun command (alias t), registers list/create/get/delete
- `cmd/tag/list.go` - List tags stub
- `cmd/tag/create.go` - Create tag stub with --name (required), --color flags
- `cmd/tag/get.go` - Get tag stub, requires 1 arg
- `cmd/tag/delete.go` - Delete tag stub, requires 1 arg
- `cmd/apikey/apikey.go` - API key noun command (alias ak), registers list/create/revoke
- `cmd/apikey/list.go` - List API keys stub
- `cmd/apikey/create.go` - Create API key stub with --name (required), --expires flags
- `cmd/apikey/revoke.go` - Revoke API key stub with --yes flag
- `cmd/org/org.go` - Org noun command (alias o), registers list/switch/members
- `cmd/org/list.go` - List orgs stub
- `cmd/org/switch.go` - Switch org stub, requires 1 arg
- `cmd/org/members.go` - List org members stub
- `cmd/action/action.go` - Action noun command (alias a), registers list/get
- `cmd/action/list.go` - List actions stub with --category flag
- `cmd/action/get.go` - Get action stub, requires 1 arg
- `cmd/protocol/protocol.go` - Protocol noun command (alias pr), registers list/get
- `cmd/protocol/list.go` - List protocols stub with --refresh flag
- `cmd/protocol/get.go` - Get protocol stub, requires 1 arg
- `cmd/wallet/wallet.go` - Wallet noun command (alias w), registers balance/tokens
- `cmd/wallet/balance.go` - Wallet balance stub with --chain flag
- `cmd/wallet/tokens.go` - Wallet tokens stub
- `cmd/template/template.go` - Template noun command (alias tp), registers list/deploy
- `cmd/template/list.go` - List templates stub
- `cmd/template/deploy.go` - Deploy template stub with --name flag
- `cmd/billing/billing.go` - Billing noun command (alias b), registers status/usage
- `cmd/billing/status.go` - Billing status stub
- `cmd/billing/usage.go` - Billing usage stub with --period flag (default "current")

## Decisions Made

None - followed plan as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 9 management noun command groups are registered and respond to their aliases
- Every kh <noun> <verb> path in the ROADMAP is present in the command tree
- Ready for plan 19-05 which will wire all commands into the root cobra command
- Ready for Phase 20 to implement --json, --jq, --dry-run, --yes, --limit output flags

## Self-Check

- [x] All 33 files created in /Users/skp/Dev/TechOps Services/cli
- [x] go build ./cmd/action/ ./cmd/protocol/ ./cmd/wallet/ ./cmd/template/ ./cmd/billing/ passes
- [x] go build ./cmd/project/ ./cmd/tag/ ./cmd/apikey/ ./cmd/org/ passes
- [x] grep -r "func init" cmd/ returns 0
- [x] grep -r ".Run = func" cmd/ returns 0
- [x] Commits fd1a84a and 68be55c exist in cli repo

## Self-Check: PASSED

---
*Phase: 19-cli-scaffold*
*Completed: 2026-03-12*
