---
phase: 20-auth-and-http-client
plan: "04"
subsystem: cli-auth-commands
tags: [auth, login, logout, status, http-client, token-resolution]
dependency_graph:
  requires: [20-02, 20-03]
  provides: [auth-commands, auth-aware-http-client]
  affects: [cmd/kh/main.go, all CLI commands using HTTPClient]
tech_stack:
  added: []
  patterns: [injectable-function-vars-for-testing, tdd-red-green]
key_files:
  created:
    - /Users/skp/Dev/TechOps Services/cli/cmd/auth/login_test.go
    - /Users/skp/Dev/TechOps Services/cli/cmd/auth/logout_test.go
    - /Users/skp/Dev/TechOps Services/cli/cmd/auth/status_test.go
  modified:
    - /Users/skp/Dev/TechOps Services/cli/cmd/auth/login.go
    - /Users/skp/Dev/TechOps Services/cli/cmd/auth/logout.go
    - /Users/skp/Dev/TechOps Services/cli/cmd/auth/status.go
    - /Users/skp/Dev/TechOps Services/cli/internal/auth/token.go
    - /Users/skp/Dev/TechOps Services/cli/internal/config/hosts.go
    - /Users/skp/Dev/TechOps Services/cli/cmd/kh/main.go
decisions:
  - Injectable function vars (BrowserLoginFunc, DeviceLoginFunc, etc.) used in cmd/auth package for testability without mocking frameworks
  - FetchTokenInfo org details fetch is non-fatal -- login succeeds even if org endpoint is unavailable
  - status command reuses FetchTokenInfoFunc injectable to avoid network calls in tests
metrics:
  duration: 8m
  completed: 2026-03-13
  tasks_completed: 2
  files_modified: 10
---

# Phase 20 Plan 04: Auth Commands and HTTPClient Wiring Summary

**One-liner:** Auth login/logout/status commands with browser/device/stdin flows, FetchTokenInfo for session details, and ResolveToken wired into HTTPClient factory.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement auth login, logout, and status commands | f01a487 | login.go, logout.go, status.go, token.go, hosts.go, 3 test files |
| 2 | Wire auth-aware token resolution into HTTPClient factory | 122aaf2 | main.go |

## What Was Built

**cmd/auth/login.go** - Replaces stub with three flows:
- Default: calls BrowserLoginFunc (opens browser, captures OAuth callback token)
- `--no-browser`: calls DeviceLoginFunc (RFC 8628 device code flow)
- `--with-token`: reads token from stdin via ReadTokenFromStdin, stores via SetTokenFunc
- After any flow, calls FetchTokenInfoFunc to print "Logged in to {host} as {email}"

**cmd/auth/logout.go** - Replaces stub:
- Calls DeleteTokenFunc to remove token from keyring
- Calls ClearHostTokenFunc to zero out hosts.yml token field
- Prints "Logged out of {host}"

**cmd/auth/status.go** - Replaces stub:
- Calls ResolveTokenFunc; returns error if AuthMethodNone
- Calls FetchTokenInfoFunc for session details
- Uses output.Printer for table (default) or JSON (--json flag) output
- Table shows: Host, User, Organization, Role, Expires, Auth Method

**internal/auth/token.go** - Added FetchTokenInfo:
- GET /api/auth/get-session with Bearer token
- Returns TokenInfo with user/org/role/expiry
- Org name/role fetched from /api/organizations/{id} (non-fatal on failure)

**internal/config/hosts.go** - Added SetHostToken and ClearHostToken helpers.

**cmd/kh/main.go** - HTTPClient factory now calls auth.ResolveToken instead of reading entry.Token directly. Full priority chain: KH_API_KEY > keyring > hosts.yml.

## Test Results

All 10 tests pass with -race flag. Full suite (`go test -race ./...`) passes.

## Deviations from Plan

**[Rule 2 - Auto-fix] Injectable function vars instead of interfaces**
- Found during: Task 1 (test writing)
- Issue: Plan specified "mock the auth package functions where needed (use function variables or interfaces)" -- function variables were simpler and sufficient
- Fix: Exported package-level vars (BrowserLoginFunc, DeviceLoginFunc, SetTokenFunc, FetchTokenInfoFunc, ResolveTokenFunc, DeleteTokenFunc, ClearHostTokenFunc) in cmd/auth package
- Files modified: login.go, logout.go, status.go

**[Rule 1 - Bug] Fixed buffer index in test calls**
- Found during: Task 1 (GREEN phase)
- Issue: iostreams.Test() returns (ios, outBuf, errBuf, inBuf) -- tests initially used wrong buffer index
- Fix: Corrected to `ios, buf, _, _` pattern

## Self-Check

Checking created files exist and commits are present.
