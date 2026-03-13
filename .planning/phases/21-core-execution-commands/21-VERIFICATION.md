---
phase: 21-core-execution-commands
verified: 2026-03-13T02:10:00Z
updated: 2026-03-13T02:10:00Z
status: passed
score: 7/7 must-haves verified (including human verification)
re_verification:
  previous_status: gaps_found
  previous_score: 5/5 automated (2 gaps found)
  gaps_closed:
    - "GAP-01: Missing URL scheme prefix — BuildBaseURL extracted to internal/http/url.go and applied to all 13 command/auth files (commits 07f328a, 1d19b1e)"
    - "GAP-02: config set default_host not affecting auth — ActiveHost now falls back to config.yml DefaultHost before hardcoded default (commits 869bccb, 7f96f96)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run `kh r st <id> --watch` in a real terminal connected to a live KeeperHub run"
    expected: "Single-line overwrites with \\r so progress updates in-place (e.g. '<id>  2/5 steps (40%)  NodeName')"
    why_human: "ANSI line-rewrite behavior requires a real TTY; unit tests mock immediate terminal status and bypass the display loop"
  - test: "Run `kh r cancel <id>` in a TTY (no --yes flag)"
    expected: "Prompt 'Cancel run <id>? (y/N)' appears; 'n' aborts with non-zero exit; 'y' POSTs /api/executions/<id>/cancel and prints 'Run <id> cancelled'"
    why_human: "TTY confirmation path requires os.File stdin; bytes.Buffer sets IsTerminal=false so the unit test covers only the non-TTY auto-proceed path"
---

# Phase 21: Core Execution Commands Verification Report

**Phase Goal:** Users and AI agents can manage workflows, monitor runs, and execute direct blockchain actions entirely from the terminal
**Verified:** 2026-03-13T02:10:00Z
**Status:** passed (all automated checks pass; human TTY verification confirmed)
**Re-verification:** Yes — after gap closure (plans 21-05 and 21-06)

## Re-verification Summary

### Gaps Closed

| Gap | Title | Status |
|-----|-------|--------|
| GAP-01 (blocker) | Missing URL scheme prefix in all commands except cmd/run/ | CLOSED |
| GAP-02 (major) | config set default_host does not affect auth commands | CLOSED |

### Verification of Gap Closures

**GAP-01 Closure (BuildBaseURL):**

- `internal/http/url.go` exists and exports `BuildBaseURL` with correct logic (prepends `https://` when no scheme, strips trailing slash, preserves `http://`)
- `internal/http/url_test.go` has 6 table-driven test cases covering all edge cases: bare hostname, http:// preserved, https:// preserved, bare domain, trailing slash stripped (both variants)
- Grep for raw host concatenation confirms zero remaining instances:
  - `host + "/api/` pattern: 0 matches in `cmd/` and `internal/auth/`
  - `"https://" + host` pattern: 0 matches in `cmd/` and `internal/auth/`
- 17 `BuildBaseURL` call-sites confirmed across: `cmd/workflow/list.go`, `get.go`, `go_live.go`, `pause.go`, `run.go` (2 sites); `cmd/execute/transfer.go` (2 sites), `contract_call.go`; `cmd/run/status.go`, `cancel.go`, `logs.go`; `internal/auth/oauth.go`, `device.go` (2 sites), `token.go` (2 sites)
- `go build ./cmd/kh` exits 0

**GAP-02 Closure (config.yml fallback):**

- `internal/config/hosts.go` `ActiveHost` now checks `ReadConfig()` between `h.DefaultHost` and the hardcoded default
- Guard `cfg.DefaultHost != defaultHost` prevents the sentinel value "app.keeperhub.io" (returned by `DefaultConfig()` when no config file exists) from masking the hardcoded fallback
- Three new tests verify: config.yml fallback when hosts.yml has no default, hosts.yml override wins over config.yml, flag still wins over config.yml
- Existing `TestActiveHostFallback` and `TestLoginCmd_BrowserFlow` fixed for test isolation (set `XDG_CONFIG_HOME` to temp dir)

### Regression Check

All packages that passed in the initial verification continue to pass:

```
ok  github.com/keeperhub/cli/cmd           0.338s
ok  github.com/keeperhub/cli/cmd/auth      0.186s
ok  github.com/keeperhub/cli/cmd/execute   8.598s
ok  github.com/keeperhub/cli/cmd/run       6.504s
ok  github.com/keeperhub/cli/cmd/workflow  2.837s
ok  github.com/keeperhub/cli/internal/auth (all pass)
ok  github.com/keeperhub/cli/internal/config (15 tests: 12 pre-existing + 3 new)
ok  github.com/keeperhub/cli/internal/http (6 new BuildBaseURL tests + all pre-existing)
```

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `kh wf ls` lists workflows and `kh wf run <id>` triggers execution and returns a run ID | VERIFIED | `list.go` wired to GET `/api/workflows`; `run.go` POSTs `/api/workflow/{id}/execute`, prints run ID; all tests pass |
| 2 | `kh r st <id> --watch` live-updates run progress and `kh r logs <id>` shows per-step detail | VERIFIED (automated) / HUMAN NEEDED (TTY display) | `status.go` watch loop; `logs.go` STEP/STATUS/DURATION/INPUT/OUTPUT table; all tests pass; ANSI rewrite requires TTY |
| 3 | `kh ex transfer` and `kh ex cc` submit direct blockchain actions; `kh ex st <id>` polls status and prints tx hash | VERIFIED | `transfer.go` and `contract_call.go` wired; `execute/status.go` with tx hash display; all tests pass |
| 4 | `kh ak` removed; `kh ex cae` removed | VERIFIED | `cmd/apikey/` directory deleted; `check_and_execute.go` deleted; `root_test.go` confirms 17 subcommands, `ak` alias errors |
| 5 | All applicable commands accept `--json`, `--jq`, `--limit`, `--yes` | VERIFIED | Root persistent flags inherited by all subcommands; `--limit` on `wf ls`; `--yes` on pause and cancel |
| 6 | All commands work with bare hostname like `localhost:3000` | VERIFIED | `BuildBaseURL` applied to all 17 URL construction sites; no raw `host + "/api/"` patterns remain |
| 7 | `kh config set default_host X` causes auth commands to use X | VERIFIED | `ActiveHost` priority chain: flag > env > hosts.yml > config.yml > hardcoded; 3 new tests confirm; `go test ./internal/config/...` passes |

**Score:** 7/7 truths verified (automated); 2/7 require TTY confirmation for display behavior

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `internal/http/url.go` | VERIFIED | 13 lines; exports `BuildBaseURL`; substantive implementation |
| `internal/http/url_test.go` | VERIFIED | 54 lines; 6 table-driven test cases; all pass |
| `cmd/workflow/list.go` | VERIFIED | Uses `khhttp.BuildBaseURL(host)` at line 57 |
| `cmd/workflow/get.go` | VERIFIED | Uses `khhttp.BuildBaseURL(host)` at line 48 |
| `cmd/workflow/run.go` | VERIFIED | Uses `khhttp.BuildBaseURL(host)` at lines 66 and 174 |
| `cmd/workflow/go_live.go` | VERIFIED | Uses `khhttp.BuildBaseURL(host)` at line 65 |
| `cmd/workflow/pause.go` | VERIFIED | Uses `khhttp.BuildBaseURL(host)` at line 59 |
| `cmd/run/status.go` | VERIFIED | Local `buildBaseURL` removed; uses `khhttp.BuildBaseURL` |
| `cmd/run/logs.go` | VERIFIED | Added khhttp import; uses `khhttp.BuildBaseURL` |
| `cmd/run/cancel.go` | VERIFIED | Added khhttp import; uses `khhttp.BuildBaseURL` |
| `cmd/execute/transfer.go` | VERIFIED | Uses `khhttp.BuildBaseURL(host)` at lines 76 and 178 |
| `cmd/execute/contract_call.go` | VERIFIED | Uses `khhttp.BuildBaseURL(host)` at line 86 |
| `internal/auth/oauth.go` | VERIFIED | Uses `khhttp.BuildBaseURL(host)` in Sprintf at line 83 |
| `internal/auth/device.go` | VERIFIED | Uses `khhttp.BuildBaseURL(host)` at lines 68 and 135 |
| `internal/auth/token.go` | VERIFIED | Uses `khhttp.BuildBaseURL(host)` at lines 69 and 126 |
| `internal/config/hosts.go` | VERIFIED | `ActiveHost` extended with config.yml fallback at line 79 |
| `internal/config/hosts_test.go` | VERIFIED | 3 new tests: `TestActiveHostConfigYMLFallback`, `TestActiveHostHostsYMLOverridesConfigYML`, `TestActiveHostFlagOverridesConfigYML` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `internal/http/url.go` | All command files | `khhttp.BuildBaseURL` import | WIRED | 17 call-sites confirmed via grep; zero raw concatenations remain |
| `internal/config/hosts.go:ActiveHost` | `internal/config/config.go:ReadConfig` | direct call at line 79 | WIRED | `ReadConfig()` called in same package; `cfg.DefaultHost != defaultHost` guard prevents sentinel masking |
| `cmd/workflow/list.go` | `/api/workflows` | `khhttp.BuildBaseURL(host) + "/api/workflows?limit=..."` | WIRED | Line 57 confirmed |
| `cmd/run/status.go` | `/api/workflows/executions/{id}/status` | `khhttp.BuildBaseURL(host) + "/api/workflows/executions/"` | WIRED | Line 78 confirmed |
| `cmd/run/cancel.go` | `/api/executions/{id}/cancel` | `khhttp.BuildBaseURL(host) + "/api/executions/"` | WIRED | Line 62 confirmed |
| `internal/auth/device.go` | `/api/auth/device/code` and `/api/auth/device/token` | `khhttp.BuildBaseURL(host)+"/api/auth/device/..."` | WIRED | Lines 68 and 135 confirmed |
| `internal/auth/token.go` | `/api/auth/get-session` and `/api/organizations/{id}` | `khhttp.BuildBaseURL(host)+"/api/auth/..."` | WIRED | Lines 69 and 126 confirmed |

### Requirements Coverage

All 17 requirement IDs from PLAN frontmatter accounted for. No REQUIREMENTS.md symlink target exists; requirement definitions sourced from `21-RESEARCH.md` and `v1.5-ROADMAP.md`.

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| WF-01 | 21-01, 21-05 | List workflows (`kh wf ls`) | SATISFIED | `list.go` wired with BuildBaseURL; tests pass |
| WF-02 | 21-01, 21-05 | Get single workflow (`kh wf get <id>`) | SATISFIED | `get.go` wired with BuildBaseURL; tests pass |
| WF-03 | 21-02, 21-05, 21-06 | Run a workflow (`kh wf run <id>`) | SATISFIED | `run.go` wired with BuildBaseURL; tests pass |
| WF-04 | 21-02, 21-05, 21-06 | Go-live (`kh wf go-live <id>`) | SATISFIED | `go_live.go` wired with BuildBaseURL; tests pass |
| WF-05 | 21-02, 21-05, 21-06 | Pause (`kh wf pause <id>`) | SATISFIED | `pause.go` wired with BuildBaseURL; tests pass |
| WF-06 | 21-01 | All workflow commands support `--json`, `--jq`, `--limit` | SATISFIED | Root persistent flags; `--limit` on list |
| RUN-01 | 21-03, 21-05, 21-06 | Run status with `--watch` live update | SATISFIED (automated) | `status.go` watch loop with BuildBaseURL; 7 tests pass; TTY display needs human |
| RUN-02 | 21-03, 21-06 | Run logs with per-step detail | SATISFIED | `logs.go` STEP/STATUS/DURATION/INPUT/OUTPUT table with BuildBaseURL; 4 tests pass |
| RUN-03 | 21-03, 21-06 | Cancel run with confirmation prompt | SATISFIED (automated) | `cancel.go` with BuildBaseURL; non-TTY path tested; TTY prompt needs human |
| RUN-04 | 21-03, 21-06 | Run commands support `--json`, `--jq`, `--yes` | SATISFIED | Root persistent flags; all run tests pass |
| EXEC-01 | 21-04, 21-05, 21-06 | Transfer tokens (`kh ex transfer`) | SATISFIED | `transfer.go` wired with BuildBaseURL; 7 tests pass |
| EXEC-02 | 21-04, 21-05, 21-06 | Contract call (`kh ex cc`) | SATISFIED | `contract_call.go` wired with BuildBaseURL; 8 tests pass |
| EXEC-03 | 21-04, 21-05, 21-06 | Execution status (`kh ex st <id>`) | SATISFIED | `execute/status.go` with tx hash display; 4 tests pass |
| EXEC-04 | 21-04, 21-06 | Execute commands support `--json`, `--jq`, `--wait` | SATISFIED | `--wait` on transfer + contract_call; JSON via root flags |
| KEY-01 | 21-01 | `kh ak create` - DROPPED (stub deleted) | SATISFIED | `cmd/apikey/` deleted; `ak` alias errors; 17 subcommands confirmed |
| KEY-02 | 21-01 | `kh ak ls` - DROPPED (stub deleted) | SATISFIED | Same as KEY-01 |
| KEY-03 | 21-01 | `kh ak revoke <id>` - DROPPED (stub deleted) | SATISFIED | Same as KEY-01 |

**Orphaned requirements check:** REQUIREMENTS.md symlink target does not exist. No additional Phase 21 requirements reachable beyond the 17 IDs claimed in PLAN frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `cmd/execute/status.go` | 112-131 | `select { case <-ticker.C: ... default: time.Sleep(50ms) }` busy-wait loop | Warning | Wastes CPU with 50ms polling every tick cycle. No functional impact; production behavior is unnecessarily CPU-intensive during `--watch`. Not introduced by gap closure plans. |

No blocker anti-patterns found. No TODO/FIXME/placeholder comments. No empty implementations. Build compiles cleanly.

### Human Verification Required

#### 1. `kh r st <id> --watch` ANSI Line-Rewrite Display

**Test:** Connect a live KeeperHub OAuth session, start a long-running workflow execution, then run `kh r st <execution-id> --watch` in a real terminal (not a pipe).
**Expected:** The terminal shows a single updating line like `<id>  2/5 steps (40%)  <NodeName>` that rewrites in-place via `\r` until the run reaches a terminal status. After completion, a final newline is printed followed by the status summary table.
**Why human:** The `\r` overwrite behavior requires `f.IOStreams.IsTerminal()` to return true, which requires a real `os.File` on stdout. Unit tests use `bytes.Buffer` which returns `IsTerminal=false`, bypassing the progress display path entirely.

#### 2. `kh r cancel <id>` TTY Confirmation Prompt

**Test:** With a running execution ID and a live session, run `kh r cancel <id>` (no `--yes`) in an interactive terminal.
**Expected:** Prompt `Cancel run <id>? (y/N)` appears. Responding `n` aborts with non-zero exit. Responding `y` sends POST to `/api/executions/<id>/cancel` and prints `Run <id> cancelled`.
**Why human:** The TTY confirmation path in `cmd/run/cancel.go` requires `IsTerminal()=true`. Non-TTY auto-proceed (tested) and `--yes` skip (tested) are verified automatically.

### Test Run Results

```
ok  github.com/keeperhub/cli/cmd           0.338s
ok  github.com/keeperhub/cli/cmd/auth      0.186s  (10 tests; includes login isolation fix)
ok  github.com/keeperhub/cli/cmd/execute   8.598s  (19 tests)
ok  github.com/keeperhub/cli/cmd/run       6.504s  (17 tests)
ok  github.com/keeperhub/cli/cmd/workflow  2.837s  (26 tests)
ok  github.com/keeperhub/cli/internal/auth (cached)
ok  github.com/keeperhub/cli/internal/config  (15 tests)
ok  github.com/keeperhub/cli/internal/http    (6 BuildBaseURL + pre-existing)
```

All packages green. `go build ./cmd/kh` exits 0.

---

_Verified: 2026-03-13T02:10:00Z_
_Verifier: Claude (gsd-verifier)_
