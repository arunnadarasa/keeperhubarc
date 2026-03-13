---
phase: 21-core-execution-commands
plan: 04
subsystem: api
tags: [go, cobra, httptest, execute, blockchain, transfer, contract-call]

requires:
  - phase: 20-auth-and-http-client
    provides: "Factory.HTTPClient returns khhttp.Client with auth injection; Factory.Config provides DefaultHost"
  - phase: 21-core-execution-commands
    provides: "ExecStatusResponse type shared across transfer, contract-call, and status commands"

provides:
  - "kh ex transfer: POST /api/execute/transfer with chain/to/amount/token-address flags"
  - "kh ex cc: POST /api/execute/contract-call with read(200)/write(202) detection, --abi-file support"
  - "kh ex st: GET /api/execute/{id}/status with --watch polling and --json output"
  - "Shared pollExecStatus and fetchExecStatus helpers reused by all execute commands"
  - "ExecStatusResponse type exported for reuse across commands"

affects: [21-core-execution-commands, 23-mcp-server]

tech-stack:
  added: []
  patterns:
    - "Host obtained from cfg.DefaultHost (Factory.Config) for API URL construction"
    - "Fire-and-forget default; --wait polls via ticker+select with timeout deadline"
    - "HTTP status code determines response type: 200=read result, 202=write execution ID"
    - "Test factories inject httptest.Server URL via Config.DefaultHost"
    - "pollExecStatus/fetchExecStatus shared between transfer and contract-call"

key-files:
  created:
    - cmd/execute/transfer.go
    - cmd/execute/contract_call.go
    - cmd/execute/status.go
    - cmd/execute/transfer_test.go
    - cmd/execute/contract_call_test.go
    - cmd/execute/status_test.go
  modified: []

key-decisions:
  - "Read/write detection uses HTTP status code: 200=read (result only), 202=write (executionId+status)"
  - "--args changed from StringSlice to String to accept raw JSON array without cobra CSV parsing"
  - "ExecStatusResponse exported from status.go for shared use by transfer.go polling"
  - "printTransferResult and printExecStatusResult as helpers to avoid duplication between fire-and-forget and polling paths"

patterns-established:
  - "Execute command test pattern: newXxxFactory(ios, srv) injects httptest.Server URL via Config.DefaultHost"
  - "Wait/poll pattern: check if initial response already terminal before starting ticker loop"

requirements-completed: [EXEC-01, EXEC-02, EXEC-03, EXEC-04]

duration: 7min
completed: 2026-03-13
---

# Phase 21 Plan 04: Core Execution Commands Summary

**Direct blockchain execution via `kh ex transfer`, `kh ex cc`, and `kh ex st` with fire-and-forget default, --wait polling, read(200)/write(202) detection, and --abi-file for local ABI injection**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-13T00:13:06Z
- **Completed:** 2026-03-13T00:20:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Transfer command: `kh ex transfer --chain 1 --to 0x... --amount 0.1` posts to `/api/execute/transfer` with correct JSON field mapping (chain->network, to->recipientAddress); --token-address for ERC-20 tokens; --wait polls or skips if already terminal
- Contract-call command: `kh ex cc` detects read-only (200) vs write (202) responses; --args accepts raw JSON array string; --abi-file reads local file into request body; --wait is no-op for reads
- Status command: `kh ex st <id>` single-shot GET with table/JSON output; --watch polls with TTY line overwrite until terminal; failed status returns non-zero exit

## Task Commits

1. **Task 1: Transfer and contract-call commands** - `8baae2d` (feat)
2. **Task 2: Execution status command** - `9625852` (feat)

## Files Created/Modified

- `cmd/execute/transfer.go` - Transfer command, transferRequest/transferResponse types, printTransferResult helper
- `cmd/execute/contract_call.go` - ContractCall command with read/write response branching, --abi-file file reading
- `cmd/execute/status.go` - ExecStatusResponse type (exported), StatusCmd, renderExecStatus, watchExecStatus, pollExecStatus, fetchExecStatus helpers
- `cmd/execute/transfer_test.go` - 7 tests: field mapping, required flags, tokenAddress, JSON output, wait-already-terminal, wait-polls
- `cmd/execute/contract_call_test.go` - 8 tests: field mapping, required flags, args string type, abi-file, read 200, write 202, wait-noop-read, wait-polls-write
- `cmd/execute/status_test.go` - 4 tests: status table, JSON output, failed exits 1, watch polls until terminal

## Decisions Made

- `--args` changed from StringSlice to String: cobra's StringSlice uses CSV parsing which breaks JSON array strings like `'["0xdef"]'` (contains quotes). String flag passes value verbatim.
- ExecStatusResponse exported from status.go: both transfer.go's `printExecStatusResult` and status.go's `renderExecStatus` need the same type; exporting from status.go avoids a separate types file.
- Read/write detection by HTTP status code: 200 = read-only (no executionId in response), 202 = write (has executionId). This matches API contract from RESEARCH.md.
- `printTransferResult` helper: avoids duplicating the table rendering logic between the fire-and-forget path and the already-terminal --wait path.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Pre-existing `check_and_execute.go` was already removed in a prior commit (21-01), so `execute.go` had already been updated to not reference it. No action needed.

## Next Phase Readiness

- All direct execution commands functional with full test coverage
- `ExecStatusResponse` type available for any future commands that need execution status
- Ready for Phase 22 or MCP integration in Phase 23

---
*Phase: 21-core-execution-commands*
*Completed: 2026-03-13*
