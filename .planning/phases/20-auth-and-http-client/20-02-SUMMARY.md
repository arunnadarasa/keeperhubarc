---
phase: 20-auth-and-http-client
plan: "02"
subsystem: cli-output
tags: [output, errors, exit-codes, json, jq, table, printer]
dependency_graph:
  requires: []
  provides: [output-contract, exit-code-mapping, printer-abstraction]
  affects: [21-workflow-commands, 22-protocol-commands, 23-mcp-server, 24-distribution]
tech_stack:
  added: [github.com/itchyny/gojq v0.12.18, github.com/jedib0t/go-pretty/v6 v6.7.8]
  patterns: [TDD red-green per task, in-process jq filtering, TTY-aware table rendering]
key_files:
  created:
    - /Users/skp/Dev/TechOps Services/cli/pkg/cmdutil/errors_test.go
    - /Users/skp/Dev/TechOps Services/cli/internal/output/json.go
    - /Users/skp/Dev/TechOps Services/cli/internal/output/json_test.go
    - /Users/skp/Dev/TechOps Services/cli/internal/output/jq.go
    - /Users/skp/Dev/TechOps Services/cli/internal/output/jq_test.go
    - /Users/skp/Dev/TechOps Services/cli/internal/output/table.go
    - /Users/skp/Dev/TechOps Services/cli/internal/output/table_test.go
    - /Users/skp/Dev/TechOps Services/cli/internal/output/printer.go
    - /Users/skp/Dev/TechOps Services/cli/internal/output/printer_test.go
  modified:
    - /Users/skp/Dev/TechOps Services/cli/pkg/cmdutil/errors.go
    - /Users/skp/Dev/TechOps Services/cli/cmd/kh/main.go
    - /Users/skp/Dev/TechOps Services/cli/internal/http/client.go
    - /Users/skp/Dev/TechOps Services/cli/go.mod
    - /Users/skp/Dev/TechOps Services/cli/go.sum
decisions:
  - "go-pretty header rendering uppercases text by default; tests check for NAME or Name"
  - "ApplyJQFilter returns single value directly (not slice) when jq produces exactly one result"
  - "Printer.PrintTable renders inline (caller calls tw.Render()); Printer owns the table.Writer creation"
metrics:
  duration: ~8 min
  completed_date: "2026-03-13"
  tasks_completed: 3
  files_created: 9
  files_modified: 4
---

# Phase 20 Plan 02: Output Formatting and Exit Code Contract Summary

**One-liner:** Output contract with NotFoundError/RateLimitError exit codes (0/1/2/5), WriteJSON/ApplyJQFilter/NewTable modules, and Printer abstraction routing --json/--jq/table output via gojq and go-pretty.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add error types and exit code handler | 6b96cf6 | errors.go, errors_test.go, main.go, client.go |
| 2 | Build JSON, jq, and table output modules | a0b1ca6 | json.go, jq.go, table.go + tests, go.mod |
| 3 | Build Printer output router | b1af1d0 | printer.go, printer_test.go |

## What Was Built

**Error types and exit codes (pkg/cmdutil/errors.go):**
- `NotFoundError` wraps 404 responses, exit code 2
- `RateLimitError` wraps 429 responses with optional RetryAfter duration, exit code 5
- `ExitCodeForError` maps all error types: nil/CancelError->0, FlagError/NotFoundError->2, RateLimitError->5, default->1
- `cmd/kh/main.go` updated to use `ExitCodeForError` instead of hardcoded `os.Exit(1)`
- HTTP client `CheckRetry` set to prevent retrying 429 responses (rate limits bubble up instead of retrying 3x)

**Output modules (internal/output/):**
- `json.go`: `WriteJSON` (indented, trailing newline) and `WriteJSONError` ({"error","code"} to stderr)
- `jq.go`: `ApplyJQFilter` using gojq in-process, no external binary required
- `table.go`: `NewTable` with go-pretty, `StyleLight` for TTY, `StyleDefault` for non-TTY pipe output

**Printer abstraction (internal/output/printer.go):**
- `NewPrinter` reads `--json` and `--jq` flags from cobra.Command; `--jq` implies JSON mode
- `PrintData(data, tableFn)` dispatches to JSON or table based on flags
- `PrintDryRun` writes `[dry-run] message` (plain) or `{"dry_run":true,"message":"..."}` (JSON)
- `PrintError` writes to ErrOut as JSON object or plain text

## Test Results

```
ok  github.com/keeperhub/cli/pkg/cmdutil      -- 12 tests (all pass)
ok  github.com/keeperhub/cli/internal/output  -- 16 tests (all pass)
go test -race ./...                           -- all packages pass
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] go-pretty header uppercase mismatch in table test**
- **Found during:** Task 2
- **Issue:** go-pretty uppercases header text by default ("Name" -> "NAME"), test expected "Name"
- **Fix:** Updated test to accept either "NAME" or "Name" as valid
- **Files modified:** internal/output/table_test.go
- **Commit:** a0b1ca6

**2. [Rule 3 - Blocking] Missing go.sum entries for go-pretty transitive dependencies**
- **Found during:** Task 2 first test run
- **Issue:** go-pretty requires mattn/go-runewidth and golang.org/x/text but go.sum was incomplete
- **Fix:** Ran `go get github.com/jedib0t/go-pretty/v6/text@v6.7.8` then `go mod tidy`
- **Files modified:** go.mod, go.sum
- **Commit:** a0b1ca6

## Self-Check: PASSED

Files verified present:
- /Users/skp/Dev/TechOps Services/cli/pkg/cmdutil/errors.go -- FOUND
- /Users/skp/Dev/TechOps Services/cli/internal/output/printer.go -- FOUND
- /Users/skp/Dev/TechOps Services/cli/internal/output/jq.go -- FOUND
- /Users/skp/Dev/TechOps Services/cli/internal/output/table.go -- FOUND
- /Users/skp/Dev/TechOps Services/cli/internal/output/json.go -- FOUND

Commits verified:
- 6b96cf6 -- FOUND
- a0b1ca6 -- FOUND
- b1af1d0 -- FOUND
