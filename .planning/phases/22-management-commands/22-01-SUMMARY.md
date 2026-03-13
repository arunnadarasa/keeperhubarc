---
phase: 22-management-commands
plan: "01"
subsystem: cli-commands
tags: [go, cobra, crud, project, tag, http, tdd]
dependency_graph:
  requires: [phase-20-auth-and-http-client, phase-21-core-execution-commands]
  provides: [project-crud-commands, tag-crud-commands]
  affects: [cmd/project, cmd/tag]
tech_stack:
  added: []
  patterns:
    - GET list + client-side filter (no dedicated GET-by-ID for projects/tags)
    - positional name arg (cobra.MinimumNArgs(1)) replacing --name required flag
    - persistent --json/--jq/--yes on parent cmd for test isolation without root
    - TDD red-green cycle: tests committed before implementation
key_files:
  created:
    - cmd/project/list_test.go
    - cmd/project/create_test.go
    - cmd/project/get_test.go
    - cmd/project/delete_test.go
    - cmd/tag/list_test.go
    - cmd/tag/create_test.go
    - cmd/tag/get_test.go
    - cmd/tag/delete_test.go
  modified:
    - cmd/project/list.go
    - cmd/project/create.go
    - cmd/project/get.go
    - cmd/project/delete.go
    - cmd/project/project.go
    - cmd/tag/list.go
    - cmd/tag/create.go
    - cmd/tag/get.go
    - cmd/tag/delete.go
    - cmd/tag/tag.go
decisions:
  - Added --json, --jq, --yes as persistent flags on project/tag parent cmds for test isolation (workflow pattern)
  - delete.go fetches full list before deleting to get resource name for prompt display
  - Non-TTY auto-proceeds without confirmation (IsTerminal() false for buffer-backed IOStreams)
  - Stub local --yes flag removed from delete.go; inherited from project/tag parent persistent flag
metrics:
  duration: 7 min
  completed_date: "2026-03-13"
  tasks_completed: 2
  files_changed: 18
---

# Phase 22 Plan 01: Project and Tag CRUD Commands Summary

Project and tag CRUD commands implemented with real HTTP+output logic replacing stub placeholders. Both resource types follow identical patterns: GET list with table output, POST create with positional name arg, GET list + client-side filter for get, DELETE with confirmation prompt.

## Tasks Completed

### Task 1: Implement project CRUD commands

**Commits:**
- `7e3db23` - test(22-01): add failing tests for project CRUD commands (RED)
- `62e0bff` - feat(22-01): implement project CRUD commands (GREEN)

**Files:** cmd/project/{list,create,get,delete}.go, cmd/project/project.go, cmd/project/{list,create,get,delete}_test.go

**What was built:**
- `kh p ls`: GET /api/projects, table with ID/NAME/DESCRIPTION/WORKFLOWS, empty hint
- `kh p create <name>`: positional name arg, POST /api/projects with {name, description}
- `kh p get <id>`: GET /api/projects, filter client-side by ID, NotFoundError if not found
- `kh p rm <id>`: fetch project name, confirmation prompt, DELETE /api/projects/{id}, rm alias

### Task 2: Implement tag CRUD commands

**Commits:**
- `f50e44e` - test(22-01): add failing tests for tag CRUD commands (RED)
- `62419e8` - feat(22-01): implement tag CRUD commands (GREEN)

**Files:** cmd/tag/{list,create,get,delete}.go, cmd/tag/tag.go, cmd/tag/{list,create,get,delete}_test.go

**What was built:**
- `kh t ls`: GET /api/tags, table with ID/NAME/COLOR/WORKFLOWS, empty hint
- `kh t create <name>`: positional name arg, default color #6366f1, POST /api/tags
- `kh t get <id>`: GET /api/tags, filter client-side by ID, NotFoundError if not found
- `kh t rm <id>`: fetch tag name, confirmation prompt, DELETE /api/tags/{id}, rm alias

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added persistent --json/--jq/--yes flags to project.go and tag.go**
- **Found during:** Task 1 test setup
- **Issue:** Tests call NewProjectCmd(f) directly without root command. --json, --jq, --yes are persistent on root but not accessible when running parent cmd in isolation.
- **Fix:** Added persistent --json, --jq, --yes to project.NewProjectCmd and tag.NewTagCmd following the workflow.NewWorkflowCmd pattern (which does the same).
- **Files modified:** cmd/project/project.go, cmd/tag/tag.go
- **Commits:** 62e0bff, 62419e8

**2. [Rule 1 - Bug] Removed local --yes flag from delete.go stubs**
- **Found during:** Task 1 implementation
- **Issue:** Stubs defined local --yes; with --yes now on the parent persistent flags, the local definition would shadow it or cause confusion.
- **Fix:** Removed local flag definitions; delete commands use `cmd.Flags().GetBool("yes")` which traverses up to find the persistent flag.
- **Files modified:** cmd/project/delete.go, cmd/tag/delete.go

## Verification

```
go test ./cmd/project/... ./cmd/tag/... -count=1
```

Result: All 25 tests pass (12 project + 13 tag).

Full suite: `go test ./... -count=1` -- all packages pass.

## Self-Check: PASSED

Files exist:
- cmd/project/list.go: FOUND
- cmd/project/create.go: FOUND
- cmd/project/get.go: FOUND
- cmd/project/delete.go: FOUND
- cmd/tag/list.go: FOUND
- cmd/tag/create.go: FOUND
- cmd/tag/get.go: FOUND
- cmd/tag/delete.go: FOUND

Commits exist:
- 7e3db23: FOUND (test RED project)
- 62e0bff: FOUND (feat GREEN project)
- f50e44e: FOUND (test RED tag)
- 62419e8: FOUND (feat GREEN tag)
