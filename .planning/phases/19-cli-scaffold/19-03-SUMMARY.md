---
phase: 19-cli-scaffold
plan: 03
subsystem: cli
tags: [go, cobra, cli, workflow, auth, config, completion]

requires:
  - phase: 19-01
    provides: Factory, IOStreams, config.ReadConfig/WriteConfig, internal/version.Version

provides:
  - Full cobra command tree for kh CLI (27 files, 8 noun groups)
  - workflow (alias: wf) with list(ls), run(r), get(g), go-live(live), pause subcommands
  - run (alias: r) with status(st), logs(l), cancel subcommands
  - execute (alias: ex) with transfer(t), contract-call(cc), check-and-execute(cae), status(st) subcommands
  - auth with login, logout, status subcommands (stubs)
  - config with implemented set/get/list subcommands backed by WriteConfig/ReadHosts
  - serve stub with --mcp flag
  - version command printing version + build metadata (implemented)
  - doctor stub with --json flag and doc alias
  - completion command generating bash/zsh/fish/powershell scripts via Cobra built-in

affects:
  - Phase 20 (auth commands need real implementation)
  - Phase 21 (workflow/run/execute commands need real implementation)
  - Phase 23 (serve --mcp flag wired to MCP server)

tech-stack:
  added: [cobra v1.10.0 (already in go.mod, now used in cmd tree)]
  patterns: [NewXxxCmd(f *cmdutil.Factory) constructor pattern for all commands, RunE-only (never Run), IOStreams output, no init() functions]

key-files:
  created:
    - cmd/workflow/workflow.go
    - cmd/workflow/list.go
    - cmd/workflow/run.go
    - cmd/workflow/get.go
    - cmd/workflow/go_live.go
    - cmd/workflow/pause.go
    - cmd/run/run.go
    - cmd/run/status.go
    - cmd/run/logs.go
    - cmd/run/cancel.go
    - cmd/execute/execute.go
    - cmd/execute/transfer.go
    - cmd/execute/contract_call.go
    - cmd/execute/check_and_execute.go
    - cmd/execute/status.go
    - cmd/auth/auth.go
    - cmd/auth/login.go
    - cmd/auth/logout.go
    - cmd/auth/status.go
    - cmd/config/config.go
    - cmd/config/set.go
    - cmd/config/get.go
    - cmd/config/list.go
    - cmd/serve/serve.go
    - cmd/version/version.go
    - cmd/doctor/doctor.go
    - cmd/completion/completion.go
  modified:
    - cmd/kh/main.go

key-decisions:
  - "Updated main.go to wire all commands into cobra root (Rule 3 auto-fix: blocking without cobra root)"
  - "completion command takes no Factory -- uses cmd.Root() Cobra built-in, no IOStreams needed"
  - "config set/get use fmt.Errorf error format with X prefix matching plan spec"

patterns-established:
  - "Noun command constructors: NewXxxCmd(f *cmdutil.Factory) *cobra.Command, no init()"
  - "Stub format: fmt.Fprintln(f.IOStreams.Out, \"[noun verb] is not yet implemented.\")"
  - "Error format: fmt.Errorf(\"X %s\\nHint: %s\", message, hint)"
  - "Alias convention: operational nouns (workflow=wf, run=r, execute=ex) get aliases; auth/config/serve do not"

requirements-completed: [FOUND-07, FOUND-08, FOUND-09, FOUND-10]

duration: 7min
completed: 2026-03-13
---

# Phase 19 Plan 03: Core Command Stubs Summary

**28-file cobra command tree covering 8 noun groups: workflow(wf), run(r), execute(ex), auth, config, serve, version(v), doctor(doc), completion -- with version/config/completion fully implemented and all others as stubs**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-12T21:26:09Z
- **Completed:** 2026-03-12T21:33:20Z
- **Tasks:** 2
- **Files modified:** 28

## Accomplishments

- All 8 core noun command groups created with correct aliases and RunE skeleton handlers
- config set/get/list fully implemented using WriteConfig and ReadHosts from Plan 01
- version command prints version + build metadata (GOOS/GOARCH/Go version)
- completion command generates bash/zsh/fish/powershell via Cobra built-in
- main.go updated to wire the full cobra root command tree
- go test ./... passes, go build ./cmd/kh succeeds

## Task Commits

1. **Task 1: Workflow, run, and execute command groups with stubs** - `51f154a` (feat)
2. **Task 2: Auth, config, serve, version, doctor, and completion commands** - `0baf956` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `cmd/workflow/workflow.go` - NewWorkflowCmd with wf alias, adds 5 subcommands
- `cmd/workflow/list.go` - list(ls) stub, --limit and --status flags
- `cmd/workflow/run.go` - run(r) stub, --wait flag
- `cmd/workflow/get.go` - get(g) stub
- `cmd/workflow/go_live.go` - go-live(live) stub
- `cmd/workflow/pause.go` - pause stub
- `cmd/run/run.go` - NewRunCmd (run noun) with r alias, adds 3 subcommands
- `cmd/run/status.go` - status(st) stub, --watch flag
- `cmd/run/logs.go` - logs(l) stub
- `cmd/run/cancel.go` - cancel stub, --yes flag
- `cmd/execute/execute.go` - NewExecuteCmd with ex alias, adds 4 subcommands
- `cmd/execute/transfer.go` - transfer(t) stub, --chain/--to/--amount/--token flags
- `cmd/execute/contract_call.go` - contract-call(cc) stub, --chain/--contract/--method/--args flags
- `cmd/execute/check_and_execute.go` - check-and-execute(cae) stub
- `cmd/execute/status.go` - status(st) stub, --watch flag
- `cmd/auth/auth.go` - NewAuthCmd (no alias), adds login/logout/status
- `cmd/auth/login.go` - login stub, --no-browser/--with-token flags
- `cmd/auth/logout.go` - logout stub
- `cmd/auth/status.go` - status stub
- `cmd/config/config.go` - NewConfigCmd (no alias), adds set/get/list
- `cmd/config/set.go` - implemented: reads config, sets key, writes back
- `cmd/config/get.go` - implemented: reads config, prints value for key
- `cmd/config/list.go` - implemented: prints all key=value pairs including hosts
- `cmd/serve/serve.go` - serve stub (no alias), --mcp flag
- `cmd/version/version.go` - implemented: prints version + GOOS/GOARCH/Go version
- `cmd/doctor/doctor.go` - doctor(doc) stub, --json flag
- `cmd/completion/completion.go` - implemented: bash/zsh/fish/powershell via Cobra built-in
- `cmd/kh/main.go` - updated to cobra root, wires all command constructors

## Decisions Made

- Updated main.go to wire cobra root command (Rule 3 auto-fix -- plan required `go build ./cmd/kh` to compile all commands, impossible without cobra root registration)
- completion command takes no Factory since it only needs `cmd.Root()` access via Cobra parent traversal
- config get returns error if key is unknown (even empty string) to match the plan's error spec

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated main.go to register all commands in cobra root**
- **Found during:** Task 2 (overall verification)
- **Issue:** Plan verification requires `go build ./cmd/kh` to compile all commands, but main.go had no cobra root and no command registration. The `kh version`, `kh config list`, `kh completion bash` smoke tests would all fail without the root command wiring.
- **Fix:** Replaced the placeholder `fmt.Fprintf + os.Exit(0)` in main.go with a `*cobra.Command` root that registers all 9 top-level commands
- **Files modified:** cmd/kh/main.go
- **Verification:** `./kh version`, `./kh config list`, `./kh completion bash` all produce correct output
- **Committed in:** 0baf956 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** Required for any command to be reachable. No scope creep.

## Issues Encountered

None - all tasks executed cleanly after the main.go wiring auto-fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Full command tree is wired and routable -- `kh <noun> <verb>` resolves for all 8 noun groups
- config set/get/list are fully operational against the XDG config file
- All stubs print not-implemented and exit 0, ready for Phase 20/21 implementation
- completion scripts work immediately for all shells

---
*Phase: 19-cli-scaffold*
*Completed: 2026-03-13*

## Self-Check: PASSED

- All 27 cmd files FOUND on disk
- Commits 51f154a and 0baf956 FOUND in git log
- `go build ./cmd/kh` PASS
- `go test ./...` PASS (5 test packages pass, 20 packages with no test files)
