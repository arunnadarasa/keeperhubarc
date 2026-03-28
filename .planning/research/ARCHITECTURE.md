# Architecture Research

**Domain:** Autonomous Build-Evaluate Loop — runtime evaluation integrated into KeeperHub GSD pipeline
**Researched:** 2026-03-29
**Confidence:** HIGH (based on direct inspection of existing agents, workflows, test infrastructure, seed scripts, and GSD toolchain)

---

## Standard Architecture

### System Overview

```
+-------------------------------------------------------------------+
|                    /gsd:autonomous --auto                          |
|                                                                    |
|  discuss -> plan -> execute-phase -> [NEW] evaluate -> iterate    |
+-------------------------------------------------------------------+
                             |
                +------------+------------+
                |                         |
+---------------v-----------+  +----------v------------------+
|    gsd-executor (Wave N)  |  |   gsd-evaluator (NEW agent) |
|    Builds features         |  |   Runs dev server + tests   |
|    Commits per task        |  |   Scores against criteria   |
|    Creates SUMMARY.md      |  |   Creates EVAL.md           |
+---------------------------+  +-----------------------------+
                                          |
                          +--------------+--------------+
                          |                             |
               +----------v--------+        +----------v-------+
               | Playwright MCP    |        | HTTP Assertions  |
               | (UI evaluation)   |        | (API/backend)    |
               +-------------------+        +------------------+
                          |
               +----------v----------+
               | Design Token Auditor|
               | scripts/token-audit |
               | specs/design-system/|
               +---------------------+
```

### The Build-Evaluate-Fix Cycle

```
execute-phase (builds feature)
        |
        v
post-wave hook: start-eval-server
        |
        v
gsd-evaluator agent
  |-- seed test data (scripts/seed/)
  |-- run Playwright tests (UI behaviors)
  |-- run HTTP assertions (API endpoints)
  |-- run token audit (design system)
  |-- score against plan success criteria
  |-- write EVAL.md with structured gaps
        |
        v
score >= threshold? --> PASS --> continue to gsd-verifier (existing)
        |
score < threshold? --> FAIL --> create fix tasks --> re-execute (round N+1)
        |
round cap exceeded? --> escalate to human (existing SAFE-02 pattern)
```

### Component Responsibilities

| Component | Responsibility | New or Existing |
|-----------|---------------|----------------|
| `gsd-evaluator` agent | Start dev server, seed data, run Playwright + HTTP assertions, score, write EVAL.md | New agent |
| `execute-phase` (post-wave hook) | Detect eval config, spawn gsd-evaluator after final wave | Extend existing |
| `EVAL.md` | Structured evaluation results, scores, gaps for fix task generation | New file format |
| `eval-config.yml` (per phase) | Declares success criteria, test targets, threshold score | New config format |
| `gsd-executor` (fix round) | Re-executes fix tasks generated from EVAL.md gaps | Existing, unchanged |
| `gsd-verifier` | Static code review after eval passes (unchanged role) | Existing, unchanged |
| `/build-evaluate` command | New slash command orchestrating the full cycle | New command |
| `scripts/seed/` | Existing seed scripts, invoked by evaluator before tests | Existing, unchanged |
| `tests/e2e/playwright/` | Existing Playwright tests, reused by evaluator | Existing, unchanged |
| `specs/design-system/` | Evaluation criteria for UI token compliance | Existing, read-only |

---

## Integration Points

### 1. Where Does the Evaluator Agent Live?

**Decision: New agent (`gsd-evaluator`), NOT an extension of `gsd-verifier`.**

Rationale:
- `gsd-verifier` is intentionally read-only and fast (grep, static analysis). It never starts services.
- `gsd-evaluator` requires write-adjacent capabilities: starting processes, seeding databases, running Playwright sessions.
- Separation keeps `gsd-verifier` lean and avoids tool permission conflicts.
- The two agents serve different gates: verifier = "does the code look correct?", evaluator = "does the running app behave correctly?".

Agent definition:

```
~/.claude/agents/gsd-evaluator.md
  tools: Read, Write, Bash, Grep, Glob
  color: purple
  model: sonnet (or executor_model from config)
```

The evaluator reads `eval-config.yml` from the phase directory to know what to test. It writes `EVAL.md` to the same phase directory.

### 2. How the Build-QA Loop Wires into execute-phase

**Decision: Post-final-wave hook in execute-phase, before the existing verify_phase_goal step.**

The `execute-phase` workflow already has a regression gate step and a verify step. The evaluator fits between execution and static verification:

```
execute_waves (existing)
    |
    v
post_wave_hook_validation (existing, runs pre-commit hooks)
    |
    v
[NEW] runtime_evaluation_gate
    |-- detect if EVAL_CONFIG exists in phase dir
    |-- if yes: spawn gsd-evaluator
    |-- collect EVAL.md result
    |-- if score < threshold: generate fix tasks, loop back to execute_waves
    |-- if score >= threshold OR cap reached: continue
    |
    v
regression_gate (existing)
    |
    v
verify_phase_goal (existing gsd-verifier)
```

The eval gate is conditional: it only fires if `eval-config.yml` exists in the phase directory. Phases without an eval config skip the gate entirely. This preserves backward compatibility.

Configuration check in execute-phase:

```bash
EVAL_CONFIG=$(ls "${PHASE_DIR}"/*-EVAL-CONFIG.yml 2>/dev/null | head -1)
if [ -n "$EVAL_CONFIG" ]; then
  # spawn gsd-evaluator
fi
```

**Round cap:** Configurable in the eval config (`max_rounds: 3`). Mirrors the existing SAFE-02 (2-round iteration limit for CI failures). After cap is reached, escalate to human with the EVAL.md gap report.

### 3. Dev Server Lifecycle

**Decision: Evaluator owns the full lifecycle (start, test, stop).**

The evaluator agent manages the server process using Bash. Pattern:

```bash
# Start dev server in background
pnpm dev --port 3099 &
DEV_PID=$!

# Wait for server readiness (max 60s)
timeout 60 bash -c 'until curl -s http://localhost:3099/api/health > /dev/null; do sleep 1; done'

# Run evaluations
# ...

# Teardown: kill the dev server
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

Key choices:
- Use a non-standard port (3099) to avoid colliding with the developer's running dev server on 3000.
- The port is configurable in eval-config.yml (`server_port: 3099`).
- The evaluator tracks the PID and always kills it, even on failure (trap pattern).
- Playwright tests must use `baseURL: http://localhost:3099` — this is overridable via `BASE_URL` env var, which already exists in the E2E test infrastructure (`global-setup.ts`).

For worktree isolation (parallel agents via /superpowers), each worktree gets its own port. The orchestrator assigns ports from a range (3099, 3098, 3097...) to prevent collision.

### 4. How Seed Data Gets Loaded

The existing E2E infrastructure already has a complete seeding pattern in `tests/e2e/playwright/global-setup.ts` and `tests/e2e/playwright/utils/seed.ts`. The evaluator reuses this directly.

**Decision: Evaluator calls the existing global-setup as a script, not re-implementing seeding.**

```bash
# Seed test data using existing E2E infrastructure
DATABASE_URL="${EVAL_DB_URL}" \
  BASE_URL="http://localhost:3099" \
  npx tsx tests/e2e/playwright/global-setup.ts
```

This runs `cleanupPersistentTestUsers` + `seedPersistentTestUsers` + `seedAnalyticsData` — exactly the same seed state that Playwright tests expect. No new seed scripts needed.

The evaluator inherits the existing test users:
- `pr-test-do-not-delete@techops.services` / `TestPassword123!` — primary test user
- `test-analytics@techops.services` / `TestAnalytics123!` — analytics scenarios

For feature-specific seed data (e.g., a new workflow type being tested), the eval-config can reference additional seed scripts:

```yaml
# 01-EVAL-CONFIG.yml
seed_scripts:
  - tests/e2e/playwright/utils/seed.ts  # base seed (always run)
  - scripts/seed/seed-test-workflow.ts  # feature-specific seed
```

### 5. How Evaluation Results Flow Back as Fix Tasks

**Decision: EVAL.md uses a structured gaps section (YAML frontmatter) mirroring VERIFICATION.md's gap format. The same `/gsd:plan-phase --gaps` mechanism generates fix tasks.**

EVAL.md frontmatter:

```yaml
---
phase: 01-feature-name
evaluated: 2026-03-29T14:30:00Z
status: failed | passed
score: 4/7
round: 1
max_rounds: 3
gaps:
  - criterion: "Workflow creation form shows validation error for empty name"
    type: ui_behavior
    status: failed
    reason: "Input submits without showing error message"
    evidence: "Playwright assertion failed: 'Validation error' text not visible after submit"
    fix_hints:
      - "Add required validation to workflow name input"
      - "Check form onSubmit handler in components/workflow/workflow-form.tsx"
  - criterion: "POST /api/workflows returns 400 for missing name"
    type: api_assertion
    status: failed
    reason: "Returns 200 with empty name"
    evidence: "HTTP assert: expected 400, got 200"
    fix_hints:
      - "Add name validation in app/api/workflows/route.ts"
---
```

When eval fails, the orchestrator calls `/gsd:plan-phase {phase} --eval-gaps` which reads `EVAL.md` gaps (same as `--gaps` reads `VERIFICATION.md` gaps). The planner creates fix plans tagged as `eval_closure: true`. The executor runs them. The evaluator re-runs and writes a new EVAL.md with updated scores.

This reuses the existing gap-closure infrastructure without modification. The only new element is reading from EVAL.md instead of VERIFICATION.md.

### 6. File-Based Communication Format for Eval Results

All communication between the evaluator and the orchestrator is file-based. No new inter-process communication needed.

**Files written by gsd-evaluator:**

```
.planning/phases/{phase-dir}/
  {padded}-EVAL-CONFIG.yml     # Input: what to test, thresholds, rounds
  {padded}-EVAL.md             # Output: scores, gaps, evidence
  {padded}-EVAL-ROUND-2.md     # Output: subsequent rounds (preserved for history)
```

**EVAL.md full structure:**

```markdown
---
phase: 01-workflow-creation
evaluated: 2026-03-29T14:30:00Z
status: passed | failed
score: 6/7
round: 1
max_rounds: 3
server_port: 3099
seed_ran: true
gaps:
  - criterion: "..."
    type: ui_behavior | api_assertion | design_token | unit_test
    status: failed
    reason: "..."
    evidence: "..."
    fix_hints:
      - "..."
---

# Evaluation Report: Phase {X} — {Name}

**Round:** 1 of 3
**Score:** 6/7 criteria passing
**Server:** http://localhost:3099
**Status:** FAILED — 1 gap blocking threshold

## Criteria Results

| # | Criterion | Type | Status | Evidence |
|---|-----------|------|--------|----------|
| 1 | Workflow form renders | ui_behavior | PASS | Playwright: element visible |
| 2 | Empty name shows error | ui_behavior | FAIL | Element '.error-msg' not found |
| 3 | POST /api/workflows 201 | api_assertion | PASS | HTTP: 201 received |
| 4 | Design tokens: no hardcoded colors | design_token | PASS | token-audit: 0 errors |
| ... | | | | |

## Gaps

### Gap 1: Empty name shows error
...

## Server Log (tail)
{last 20 lines of dev server output if relevant}
```

### 7. Integration with /superpowers Worktrees

The `execute-phase` workflow already uses `isolation="worktree"` when spawning executor agents. The evaluator must run in the same worktree as the code it's evaluating.

**Decision: The evaluator is spawned from within the execute-phase orchestrator, which already has access to the worktree path. Pass the worktree path explicitly.**

Pattern in execute-phase:

```
Task(
  subagent_type="gsd-evaluator",
  isolation="worktree",
  prompt="
    Evaluate phase {phase_number} against eval config.
    Working directory: {worktree_path}
    Eval config: {phase_dir}/{padded}-EVAL-CONFIG.yml
    ...
  "
)
```

When running under /superpowers (parallel builds in multiple worktrees), each build gets its own evaluator with its own port assignment. The orchestrator manages port allocation before spawning evaluators:

```bash
# Port allocation: base 3099, decrement per parallel agent
EVAL_PORT=$((3099 - AGENT_INDEX))
```

### 8. Integration with /code-review

The `/code-review` (`.claude/commands/pr-review.md`) runs as a PR-level gate, not a phase-level gate. It is not invoked inline during the build-evaluate loop.

**Decision: /code-review remains a post-PR gate. The evaluator is a pre-PR gate.**

The pipeline order is:

```
execute_waves
    -> runtime_evaluation_gate (gsd-evaluator)    [runs app, tests behaviors]
    -> regression_gate (existing)                  [runs prior phase tests]
    -> verify_phase_goal (gsd-verifier)            [static code review]
    -> update_roadmap
    -> [PR creation]
    -> /code-review (pr-review.md)                 [post-PR review, optional]
```

For the `/gsd:autonomous --auto` flow, the evaluator fires inline (no PR yet). Code review fires externally after the PR is created. This preserves the existing PR review gate without entangling it with the build loop.

---

## Recommended Project Structure

The new components slot into the existing structure with minimal additions:

```
~/.claude/agents/
  gsd-evaluator.md           # New: runtime evaluation agent

~/.claude/get-shit-done/workflows/
  execute-phase.md           # Modified: add runtime_evaluation_gate step

.planning/phases/{phase}/
  {padded}-EVAL-CONFIG.yml   # New: per-phase eval configuration
  {padded}-EVAL.md           # New: evaluation results (written by evaluator)
  {padded}-EVAL-ROUND-N.md   # New: preserved history of multi-round eval

~/.claude/get-shit-done/commands/gsd/
  build-evaluate.md          # New: standalone command for the full cycle
```

No changes to:
- `tests/e2e/playwright/` (reused as-is)
- `scripts/seed/` (reused as-is)
- `specs/design-system/` (read by evaluator, not modified)
- `gsd-verifier.md` (unchanged role)
- `gsd-executor.md` (unchanged role)
- Existing `execute-phase.md` steps (additive change only)

---

## Architectural Patterns

### Pattern 1: Eval Config as Phase Artifact

**What:** Each phase that needs runtime evaluation includes an `EVAL-CONFIG.yml` file alongside its PLAN.md. The evaluator reads this file to know what to test.

**When to use:** Phases building UI, API endpoints, or interactive behaviors. Infrastructure phases (DB migrations, config changes) skip eval.

**Trade-offs:** Requires the planner to write the config file. But this forces the planner to think about testability upfront, which improves plan quality.

**Example config:**

```yaml
# 01-EVAL-CONFIG.yml
threshold: 0.85        # 85% of criteria must pass
max_rounds: 3
server_port: 3099
seed_scripts:
  - tests/e2e/playwright/utils/seed.ts
criteria:
  - id: UI-01
    type: ui_behavior
    description: "Workflow creation form renders on /workflows/new"
    playwright_test: "tests/e2e/playwright/workflow.test.ts"
    grep_pattern: "creates a workflow"
  - id: API-01
    type: api_assertion
    description: "POST /api/workflows returns 201 with valid name"
    method: POST
    url: "/api/workflows"
    body: '{"name": "Test Workflow"}'
    auth: "test-user"
    expected_status: 201
  - id: DS-01
    type: design_token
    description: "No hardcoded colors in new UI files"
    token_audit: true
    files:
      - "components/workflow/workflow-form.tsx"
```

### Pattern 2: Round-Preserving Evaluation History

**What:** Each evaluation round writes a new file (`EVAL.md`, `EVAL-ROUND-2.md`, etc.) rather than overwriting. The orchestrator reads the latest round to determine pass/fail.

**When to use:** Always — multi-round evaluation.

**Trade-offs:** Slightly more disk usage. Worth it: full history enables post-hoc debugging of why iterations were needed.

```bash
# In gsd-evaluator: determine output file name
EXISTING_ROUNDS=$(ls "${PHASE_DIR}"/*-EVAL*.md 2>/dev/null | wc -l)
if [ "$EXISTING_ROUNDS" -eq 0 ]; then
  EVAL_OUTPUT="${PHASE_DIR}/${PADDED}-EVAL.md"
else
  ROUND=$((EXISTING_ROUNDS + 1))
  EVAL_OUTPUT="${PHASE_DIR}/${PADDED}-EVAL-ROUND-${ROUND}.md"
fi
```

### Pattern 3: Criteria Inheritance from Plan Success Criteria

**What:** If no `EVAL-CONFIG.yml` exists but the PLAN.md has `success_criteria` in its frontmatter, the evaluator auto-generates test criteria from those success criteria.

**When to use:** Lightweight evaluation without explicit config authoring. Best for simple API or behavior checks.

**Trade-offs:** Auto-generated criteria are less precise than hand-authored ones. The evaluator must interpret free-text success criteria into test patterns. Mark results as `confidence: low` when auto-derived.

### Pattern 4: Playwright Test Reuse via Grep Filter

**What:** Rather than writing new Playwright tests for each evaluation, the evaluator runs existing tests from `tests/e2e/playwright/` filtered by grep pattern. New E2E tests written during feature development are the evaluation harness.

**When to use:** When the feature has corresponding E2E tests (which it should — the `test-write.md` skill is part of the existing pipeline).

**Trade-offs:** Ties evaluation to test completeness. If E2E tests weren't written, there's nothing to run. Mitigation: the evaluator falls back to HTTP assertions for API phases when no matching Playwright tests exist.

```bash
# Run existing E2E tests matching the phase's test patterns
BASE_URL="http://localhost:3099" \
DATABASE_URL="${EVAL_DB_URL}" \
  pnpm test:e2e --grep "${EVAL_TEST_PATTERN}" \
    --reporter=json --output="${PHASE_DIR}/${PADDED}-PLAYWRIGHT-RESULTS.json"
```

---

## Data Flow

### Build-Evaluate-Fix Cycle

```
Phase Plan with EVAL-CONFIG.yml
    |
    v
execute-phase: spawn gsd-executor (builds feature)
    |
    v
execute-phase: post-wave hook detects EVAL-CONFIG.yml
    |
    v
execute-phase: spawn gsd-evaluator
    |-- reads EVAL-CONFIG.yml
    |-- starts pnpm dev on port 3099
    |-- waits for server readiness (health check)
    |-- runs globalSetup (seed test data)
    |-- for each criterion in config:
    |   |-- ui_behavior: pnpm test:e2e --grep {pattern}
    |   |-- api_assertion: HTTP request + status/body check
    |   |-- design_token: node scripts/token-audit.js {files}
    |-- calculates score
    |-- writes EVAL.md with gaps
    |-- kills dev server
    |
    v
score >= threshold?
    NO: orchestrator reads gaps from EVAL.md
        -> plan-phase --eval-gaps creates fix plans
        -> round counter incremented
        -> spawn gsd-executor for fix plans
        -> loop back to evaluator
    YES: continue to regression_gate
    CAP: escalate to human with EVAL.md report
    |
    v
regression_gate (existing)
    |
    v
verify_phase_goal (existing gsd-verifier)
```

### Communication Between Orchestrator and Evaluator

All communication is file-based. No return values from the agent are structurally required — the orchestrator reads EVAL.md after the evaluator completes.

```
Orchestrator write:     {phase_dir}/{padded}-EVAL-CONFIG.yml   (at plan time)
Evaluator reads:        {phase_dir}/{padded}-EVAL-CONFIG.yml   (at eval time)
Evaluator writes:       {phase_dir}/{padded}-EVAL.md           (results)
Orchestrator reads:     {phase_dir}/{padded}-EVAL.md           (routing)
```

Spot-check pattern (same as existing executor verification):

```bash
EVAL_EXISTS=$(test -f "${PHASE_DIR}/${PADDED}-EVAL.md" && echo "true" || echo "false")
EVAL_STATUS=$(grep "^status:" "${PHASE_DIR}/${PADDED}-EVAL.md" 2>/dev/null | cut -d: -f2 | tr -d ' ')
```

---

## Build Order Considering Dependencies

This is additive to the existing GSD infrastructure. Dependencies must be built in this order:

**Phase 1 — Evaluator Agent Foundation**

Builds the core agent without wiring it to execute-phase. Can be tested in isolation by manually invoking it on an existing phase.

1. `gsd-evaluator.md` agent definition
2. EVAL.md file format specification (document the schema)
3. EVAL-CONFIG.yml format specification

**Phase 2 — Dev Server Lifecycle**

The evaluator needs reliable server start/stop before it can run tests.

4. Server start script (wraps `pnpm dev --port N`, health-check polling, PID tracking)
5. Server stop cleanup (trap-based teardown, verify port freed)

**Phase 3 — Seed Integration**

The evaluator must be able to seed before testing.

6. Evaluator invokes `tests/e2e/playwright/global-setup.ts` via tsx with env override
7. Feature-specific seed script references from EVAL-CONFIG.yml

**Phase 4 — Test Execution Modes**

Each mode can be developed and tested independently.

8. Playwright test execution (pass `BASE_URL`, `--grep` filter, JSON reporter)
9. HTTP assertion runner (simple fetch loop against the running server)
10. Design token audit integration (`node scripts/token-audit.js --quiet`)

**Phase 5 — Scoring and EVAL.md**

11. Score calculation from criterion results
12. EVAL.md writer (structured YAML frontmatter + markdown body)
13. Round tracking (detect existing rounds, increment output file name)

**Phase 6 — execute-phase Integration**

Depends on Phase 1-5 being solid. This is the highest-risk change because it modifies an existing workflow.

14. Add `runtime_evaluation_gate` step to execute-phase.md (after post-wave hooks)
15. Eval config detection logic (conditional: skip if no EVAL-CONFIG.yml)
16. Evaluator spawn pattern (Task, worktree isolation, port assignment)
17. Round loop: read EVAL.md, decide continue/retry/escalate

**Phase 7 — Fix Task Generation**

18. `plan-phase --eval-gaps` variant: reads EVAL.md gaps instead of VERIFICATION.md gaps
19. Fix plan tagging (`eval_closure: true`)

**Phase 8 — New Command**

20. `/build-evaluate` slash command: orchestrates the full build-evaluate-fix cycle for a single phase, without requiring the full GSD pipeline

**Phase 9 — /gsd:autonomous Integration**

21. Wire evaluator into the autonomous workflow's post-execution routing (after `execute-phase` returns)

---

## Anti-Patterns

### Anti-Pattern 1: Extending gsd-verifier with Runtime Capabilities

**What people do:** Add `pnpm dev` and Playwright execution to the existing verifier agent.

**Why it's wrong:** gsd-verifier is deliberately read-only and stateless. Adding process management and service lifecycle to it breaks its single-responsibility contract. It will also slow down every verification, including phases that don't need runtime evaluation.

**Do this instead:** New `gsd-evaluator` agent with its own role. Verifier stays read-only. Evaluator handles all process management.

### Anti-Pattern 2: Blocking execute-phase on Evaluation

**What people do:** Make the evaluation synchronous and blocking in the main execute-phase flow.

**Why it's wrong:** Dev server startup takes 15-45 seconds. If the evaluator fails to start the server (port conflict, missing env var, DB not running), it blocks the entire phase execution with no fallback.

**Do this instead:** Evaluator spawned as a subagent (like executors are spawned). If spawning fails or returns timeout, the orchestrator catches the failure and routes to handle_blocker — same failure path as failed executor agents.

### Anti-Pattern 3: Hardcoding Test Credentials in the Evaluator Agent

**What people do:** Embed test email/password in the evaluator definition.

**Why it's wrong:** Credentials leak into git history. Test users change. Different environments need different credentials.

**Do this instead:** Evaluator reads credentials from `tests/e2e/playwright/utils/seed.ts` constants, or from the EVAL-CONFIG.yml `test_user` field which references a named user from the seed registry. The seed registry is the single source of truth.

### Anti-Pattern 4: Overwriting EVAL.md on Each Round

**What people do:** Re-write the same EVAL.md file on every evaluation round.

**Why it's wrong:** Loses the history of what was broken and when it was fixed. The orchestrator needs to compare round N vs round N-1 to confirm gaps were actually resolved.

**Do this instead:** First round writes `EVAL.md`. Subsequent rounds write `EVAL-ROUND-2.md`, `EVAL-ROUND-3.md`. The orchestrator reads the latest file. All history is preserved for the verifier and for post-hoc debugging.

### Anti-Pattern 5: Running Against Port 3000

**What people do:** Evaluator runs `pnpm dev` without specifying a port and tests against localhost:3000.

**Why it's wrong:** Collides with the developer's running dev server. If the developer has the app running, the evaluator either kills it (destructive) or fails to start (silent error).

**Do this instead:** Evaluator always uses a reserved non-conflicting port (3099 default). Playwright config respects `BASE_URL` env var, which the evaluator sets explicitly.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single phase eval | Current design: 1 evaluator agent, 1 dev server on 3099 |
| Parallel phase execution (/superpowers) | Port range: each worktree agent gets 3099 - N. Orchestrator tracks port assignments. |
| Many criteria per phase (20+) | Evaluator runs criteria in parallel where independent (Playwright tests parallelized by Playwright itself). HTTP assertions are sequential by default but can be batched. |
| CI integration | Set `BASE_URL` to staging URL, skip dev server lifecycle, run only HTTP assertions and token audit. Playwright tests run against deployed app. |

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| pnpm dev server | Bash process management (spawn + health poll + kill) | Use non-standard port 3099 to avoid collision |
| PostgreSQL (local) | Via existing `tests/e2e/playwright/utils/connection.ts` | Same connection pattern as E2E tests |
| Playwright | `pnpm test:e2e --grep {pattern} --reporter=json` | Reuses existing test infrastructure |
| scripts/token-audit.js | `node scripts/token-audit.js --quiet {files}` | Exits 1 on errors; evaluator reads stdout |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| execute-phase -> gsd-evaluator | Task() spawn + EVAL.md file read | Same pattern as execute-phase -> gsd-executor |
| gsd-evaluator -> plan success criteria | EVAL-CONFIG.yml (authored by planner) | Planner writes config during plan-phase |
| gsd-evaluator -> gsd-verifier | Sequential (eval passes first, then verifier runs) | No direct communication; both write to phase dir |
| orchestrator -> plan-phase --eval-gaps | EVAL.md frontmatter gaps array | Same structure as VERIFICATION.md gaps |
| evaluator -> existing E2E tests | Subprocess: pnpm test:e2e --grep | Tests run against http://localhost:3099 via BASE_URL env |
| evaluator -> design system audit | Subprocess: node scripts/token-audit.js | Script exits 1 on error; parse stdout |

---

## New vs Modified Components

### New Components

| Component | Path | Purpose |
|-----------|------|---------|
| gsd-evaluator agent | `~/.claude/agents/gsd-evaluator.md` | Runtime evaluation agent |
| EVAL-CONFIG.yml format | Per-phase in `.planning/phases/` | Evaluation configuration authored by planner |
| EVAL.md format | Per-phase in `.planning/phases/` | Structured evaluation results with gaps |
| build-evaluate command | `~/.claude/get-shit-done/commands/gsd/build-evaluate.md` | Standalone command for build-evaluate-fix cycle |

### Modified Components

| Component | Change | Risk |
|-----------|--------|------|
| execute-phase.md | Add `runtime_evaluation_gate` step (additive, conditional) | Low — gated on EVAL-CONFIG.yml presence |
| autonomous.md | Wire eval gap routing after execute-phase returns | Low — additive routing case |
| plan-phase workflow | Add `--eval-gaps` flag to read EVAL.md gaps | Low — new flag, existing mechanism |

### Unchanged Components

All existing agents (gsd-executor, gsd-verifier, gsd-planner, gsd-debugger, orchestrator, builder, researcher, debugger), all existing slash commands, all existing test infrastructure, all seed scripts.

---

## Sources

- Direct inspection: `~/.claude/get-shit-done/workflows/execute-phase.md` (post-wave hooks, failure handling, verify flow)
- Direct inspection: `~/.claude/get-shit-done/workflows/autonomous.md` (post-execution routing, gap closure cycle)
- Direct inspection: `~/.claude/agents/gsd-verifier.md` (read-only constraint, VERIFICATION.md format)
- Direct inspection: `~/.claude/agents/gsd-executor.md` (worktree isolation pattern, SUMMARY.md convention)
- Direct inspection: `tests/e2e/playwright/global-setup.ts` (seed lifecycle, ephemeral vs remote mode)
- Direct inspection: `tests/e2e/playwright/utils/seed.ts` (persistent test users, seed functions)
- Direct inspection: `tests/e2e/playwright/CLAUDE.md` (BASE_URL pattern, test patterns)
- Direct inspection: `.planning/PROJECT.md` (v1.6 milestone goals, existing agent roster)
- Direct inspection: `.planning/STATE.md` (current decisions: Playwright MCP for UI, HTTP assertions for backend)
- Direct inspection: `.claude/agents/orchestrator.md` (Blueprint pipeline, risk tiers, safeguards)
- Direct inspection: `scripts/token-audit.js` existence (confirmed), `specs/design-system/` structure

---

*Architecture research for: KeeperHub v1.6 — Autonomous Build-Evaluate Loop*
*Researched: 2026-03-29*
