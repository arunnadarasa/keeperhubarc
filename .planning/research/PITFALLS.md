# Pitfalls Research

**Domain:** Autonomous build-evaluate loop added to existing KeeperHub agent pipeline (v1.6)
**Researched:** 2026-03-29
**Confidence:** HIGH for Playwright flakiness, dev server lifecycle, and self-eval bias (multiple verified sources); MEDIUM for GSD integration specifics (reasoning from known pipeline patterns); HIGH for infinite loop / cost explosion patterns (confirmed $47K incident reports, production LLMOps data)

---

## Critical Pitfalls

### Pitfall 1: The Evaluator Agent Is the Same Model That Built the Feature

**What goes wrong:**
The evaluator (runtime QA agent) is a Claude Sonnet instance. The builder is also Claude Sonnet. When the same model family evaluates its own output, it systematically exhibits self-enhancement bias — it sees the implementation choices as correct because they match its own priors about what "good" looks like. Published research confirms Claude Sonnet produces biased scores when judging its own model's output (Spearman correlation drops from 0.86 to near-random for same-model same-output evaluation). In practice, this means the evaluator passes builds that a human reviewer would flag, particularly on subjective criteria like UI quality, error message clarity, and workflow UX. The autonomous loop silently ships work that is technically complete but experientially poor.

This is worse than the evaluator being uniformly lenient — the bias is selective. The evaluator rejects things it would do differently (style divergences) and approves things that match its own assumptions (gaps in error handling the model wouldn't notice).

**Why it happens:**
Using the same model is the obvious implementation path. The evaluator prompt is written against the same design system docs and success criteria the builder uses. Both agents read `specs/design-system/` and reach the same conclusions about compliance.

**How to avoid:**
Separate the evaluation rubric from the evaluator's judgment. Structure every criterion as a verifiable assertion with a concrete check, not a subjective "does this look right?" question:

- "Token audit script exits 0" (not "does the UI use proper tokens?")
- "API endpoint returns 200 for authenticated user" (not "does auth work?")
- "Playwright test `workflow.test.ts` passes" (not "does the workflow builder work?")

For the irreducibly subjective criteria (overall UX quality, visual consistency), do not include them in the autonomous pass/fail gate. Capture them in a separate `MANUAL_REVIEW_NEEDED` section that surfaces to the human during the GSD `human_needed` verification path — this is already the pattern in the existing Verifier agent.

Use a different model tier for evaluation than for building when the budget allows. Opus as evaluator catches what Sonnet misses in its own work.

**Warning signs:**
- Evaluator consistently passes criteria that include the word "appropriate," "reasonable," or "correct" without measurable thresholds
- Build-evaluate loop completes in round 1 every time on first attempt across multiple features
- Human reviewing the merged PRs finds the same category of issue repeatedly

**Phase to address:**
Phase 1 (Evaluator agent design). Every criterion must be expressed as a command exit code or observable state assertion before the evaluator is implemented.

---

### Pitfall 2: Flaky Playwright Tests Block or Falsely Pass Autonomous Builds

**What goes wrong:**
The existing Playwright suite (`tests/e2e/playwright/`) requires the dev server at `http://localhost:3000`, a seeded database, and persistent auth state. In autonomous mode, these conditions are harder to guarantee repeatably. Flaky tests cause two distinct failure modes:

**False negative (blocks good work):** The evaluator runs Playwright tests against a correctly-implemented feature. A timing race — React renders before async state settles, or a `waitForSelector` timeout fires 50ms early on a slow machine — causes one test to fail. The evaluator scores the build as failing. The builder tries to fix something that is not broken. The loop iterates uselessly until the round cap triggers human escalation.

**False positive (passes bad work):** The evaluator skips a Playwright test because the selector has changed (the builder renamed a `data-testid`) or the test was never scoped to cover the new feature. The evaluator reports PASS. The autonomous loop ships broken UI.

Both modes are confirmed at scale: async wait issues account for ~45% of UI test failures, and selector drift from AI-generated code is a documented production issue.

**Why it happens:**
The existing test suite is written for human CI, where a flaky test gets re-run manually. In an autonomous loop, there is no human to distinguish "this test is flaky" from "this build is broken." The evaluator treats both identically.

**How to avoid:**
Run each Playwright test file with `--retries=2` in autonomous evaluation mode. Two retries eliminates near all timing flakes without masking genuine failures. A test that fails three times on three different build-evaluate rounds is a real failure.

Tag evaluator-critical tests with `@autonomous` in their describe block name. Only run tagged tests in the autonomous loop. Full suite runs remain for CI.

Require the evaluator to verify that `data-testid` attributes referenced in tests are present in the built UI before running tests (a pre-check Grep for each testid in the test file against the built source). A missing testid is a test setup failure, not a build failure — it should halt with a diagnostic, not count against the builder's iteration limit.

**Warning signs:**
- A Playwright test passes on re-run without any code change
- The evaluator's test output shows different failure lines on consecutive rounds for the same test
- Evaluator scores differ by more than one criterion between runs of the same build

**Phase to address:**
Phase 2 (Playwright evaluation harness). Configure retry policy and test tagging before wiring Playwright into the evaluator's pass/fail gate.

---

### Pitfall 3: Dev Server Zombie Processes Block Port 3000 Between Evaluation Rounds

**What goes wrong:**
Each build-evaluate round requires a fresh dev server. When the evaluator starts `pnpm dev` and then the round ends (pass, fail, or timeout), the evaluator must cleanly terminate the process. Node.js process trees — specifically `next dev` which spawns multiple worker processes — do not cleanly terminate when the parent is killed with SIGTERM or when the shell spawning it exits. The child workers continue running and hold port 3000. The next round's `pnpm dev` attempt fails with `EADDRINUSE :::3000`. This is a confirmed open issue in Next.js (vercel/next.js#58184): "next dev keeps occupying port even after being stopped."

Without zombie cleanup, every build-evaluate round after the first has a ~40% chance of failing at server startup, before any evaluation begins.

**Why it happens:**
Subprocess management in agentic contexts is not like subprocess management in scripts. The evaluator agent starts the server as a side effect and has no reliable process group to kill when done. Claude Code's Bash tool does not maintain a persistent shell session with process lifecycle awareness.

**How to avoid:**
Use a dedicated server management script rather than inline `pnpm dev`. The script must:

1. Record the PID on startup to a file: `echo $$ > .e2e-server.pid`
2. Use `pkill -P $(cat .e2e-server.pid)` to kill the process group, not just the parent
3. Wait for port 3000 to become available before returning: `while lsof -i:3000 >/dev/null 2>&1; do sleep 0.2; done`
4. Run port cleanup before each startup: `lsof -ti:3000 | xargs kill -9 2>/dev/null || true`

Encapsulate this in `scripts/e2e-server.sh start|stop|restart`. The evaluator calls this script, not `pnpm dev` directly.

Alternatively (and preferably), use Playwright's built-in `webServer` config in `playwright.config.ts`, which handles this correctly and is already how many Playwright + Next.js setups work. The evaluator calls `pnpm test:e2e` rather than managing the server manually, and Playwright's webServer block handles startup and shutdown.

**Warning signs:**
- `EADDRINUSE :::3000` appearing in round 2+ logs without any prior server startup in that round
- `pnpm dev` output contains "port 3000 is already in use, trying 3001" — Next.js auto-switching ports silently
- Evaluation results from round N+1 are against the code from round N (old server still running)

**Phase to address:**
Phase 2 (dev server lifecycle). Establish server management script and test it with deliberate kill signals before integrating into the evaluator.

---

### Pitfall 4: Infinite Fix-Evaluate Loops from Non-Convergent Failure Criteria

**What goes wrong:**
The builder gets a failing evaluation. It makes a fix. The evaluator runs again and fails on a different criterion — not because the first fix was wrong but because fixing one thing caused the evaluator to look at a new part of the feature and find something new to fail. The builder fixes that. The evaluator fails again. This continues until the round cap triggers human escalation, which arrives with 4 rounds of changes, no clear root cause, and a diff that is much larger than the original scope.

A real production incident: two agents in a recursive loop ran for 11 days and cost $47,000 because neither agent had a convergence check or cost limit. KeeperHub's existing 2-round SAFE-02 limit partially addresses this, but the evaluate-rebuild loop operates outside the existing safeguard's scope — SAFE-02 counts lint/type-check fix rounds, not build-evaluate rounds.

**Why it happens:**
The evaluator has a list of N criteria. On each run it checks all N. If the builder fixes criterion 3 but criterion 7 now fails where it previously didn't (because the fix changed the approach), the net number of failing criteria stays roughly constant across rounds. The loop never converges because the failure mode shifts rather than shrinking.

**How to avoid:**
Evaluator criteria must be additive, not substitutive. Once a criterion passes, it is locked — the evaluator does not re-check previously passed criteria in subsequent rounds. Only the previously failing criteria are re-evaluated. This gives the builder a clear target that shrinks each round.

Implement an explicit convergence check: if the set of failing criteria is identical between round N and round N-1, the loop is stuck. Escalate immediately — do not consume another round. The existing SAFE-02 counter must be extended to cover build-evaluate rounds, not just lint/type-check rounds.

Set a hard cost limit per autonomous task. Before spawning a new evaluation round, check `round_count >= cap`. KeeperHub's existing `2-round iteration limit` (SAFE-02) should apply directly to the build-evaluate cycle. The cap should be configurable (default: 2, not higher).

**Warning signs:**
- Evaluation reports from rounds 2 and 3 fail on different criteria than round 1 but pass the same total number
- Builder diffs growing larger each round rather than smaller
- Round 3 touches files that were not in the original plan scope

**Phase to address:**
Phase 1 (loop architecture). The convergence rule and cost cap must be designed before the loop is implemented, not added after the first runaway incident.

---

### Pitfall 5: Evaluator Calibration Drift — Scoring Becomes Meaningless Over Time

**What goes wrong:**
The evaluator prompt is written once. Over the life of the v1.6 milestone, the evaluator is invoked hundreds of times against different features. Subtle changes compound: the builder's output style shifts as the codebase grows; new components become the norm; the design system gets additions that aren't in the evaluator's rubric. The evaluator begins failing things that are correct (false negatives) or passing things that have regressed (false positives). The pass rate of the first round drifts from an initial calibration of ~60% toward either ~90% (too lenient) or ~20% (too strict), neither of which represents useful signal.

Published research identifies this as "silent drift" — updating the evaluator prompt, switching judge models, or adding new criteria changes the baseline, but there is no alert when this happens. In KeeperHub's case, the evaluator is not used in enough volume to detect drift statistically, making this harder to catch.

**Why it happens:**
The evaluator prompt is treated as static infrastructure rather than as something that requires maintenance. In a build-evaluate loop where the evaluator IS the quality gate, drift in the evaluator's calibration is equivalent to drift in the team's quality standards.

**How to avoid:**
Maintain a small set of calibration fixtures — golden inputs with known correct pass/fail verdicts. After any change to the evaluator prompt, run the calibration fixtures and verify the verdicts match the expected outcomes. This is analogous to unit tests for the evaluator itself.

Categorize criteria into mechanical and judgmental:
- Mechanical: "pnpm check exits 0", "token audit exits 0", "API returns 200" — these cannot drift by definition
- Judgmental: "UI matches design spec", "error messages are clear" — these drift

Minimize judgmental criteria in the autonomous gate. Move them to `MANUAL_REVIEW_NEEDED`. The autonomous pass/fail gate should be 80%+ mechanical criteria.

**Warning signs:**
- First-round pass rate climbs above 80% or drops below 30% without a corresponding change in builder output quality
- The evaluator passes a feature that the human reviewer finds obviously incomplete
- Different phases of the same milestone produce wildly different first-round pass rates despite similar complexity

**Phase to address:**
Phase 1 (evaluator design) for the mechanical/judgmental split. Phase 3 (calibration) after the first 5 evaluation runs — create calibration fixtures based on real examples seen in phases 1-2.

---

### Pitfall 6: Seed Data Contamination Between Evaluation Rounds

**What goes wrong:**
Round 1: evaluator seeds the database, runs Playwright tests, finds failures. Builder fixes the code. Round 2: evaluator runs again against the same database. The seed data from round 1 is still present. The evaluator creates a second set of test users/workflows/runs on top. Some tests now fail because they expect exactly N workflows and find 2N. Or worse: a Playwright test that checked "no existing workflows" now finds round-1-seeded workflows and fails with a false negative.

The existing cleanup mechanism (`cleanupPersistentTestUsers` in `global-teardown.ts`) assumes a clean teardown-then-setup cycle. In an autonomous multi-round loop, teardown and setup need to be explicit per-round, not per-session.

**Why it happens:**
The existing seed/cleanup infrastructure is designed for one setup → all tests → one teardown per session. The autonomous loop runs multiple teardown-setup cycles within a single session. If any round's teardown fails (network error, process kill during teardown), contamination accumulates.

**How to avoid:**
The evaluator must treat each round as an isolated environment:

1. Before each round: run cleanup, verify the cleanup succeeded (query counts of known test entities should be 0), then run setup
2. Use unique identifiers per round (not per session): `seed-round-{round_number}-{timestamp}` prefixes on seeded entity names
3. After teardown failure: halt the round and escalate rather than proceeding with contaminated data

The Playwright `global-setup.ts` already does cleanup-then-seed correctly. The evaluator must call it explicitly rather than relying on Playwright's built-in lifecycle, because the lifecycle does not reset between Playwright invocations within the same Node process.

**Warning signs:**
- Test that checks entity counts fails in round 2 but passes in round 1
- Workflow names or user emails from a previous round appear in round 2 test output
- `cleanupPersistentTestUsers` query returns 0 rows deleted when called at the start of round 2

**Phase to address:**
Phase 2 (seed lifecycle). Implement the per-round isolation protocol before running any multi-round evaluation.

---

### Pitfall 7: Context Window Degradation in Multi-Round Build-Evaluate Loops

**What goes wrong:**
Each evaluation round produces a full evaluation report. The report gets appended to the builder's context for round 2. By round 3, the builder's context contains: original plan + research report + implementation report from round 1 + evaluation report from round 1 + fix implementation report + evaluation report from round 2. The context window fills with redundant history. The builder starts making contradictory edits ("undo the change from round 1 that the evaluator in round 2 asked to keep") because it is attending to evaluation comments that are no longer valid after subsequent fixes.

This matches the documented "Forgetting Agent" failure mode: multi-turn agent conversations degrade as context fills, causing the agent to repeat mistakes or contradict its own earlier decisions.

**Why it happens:**
In the existing Blueprint pipeline, each agent gets a fresh context window. The build-evaluate loop differs because it needs to track *what failed previously and was fixed* — which requires context continuity. But continuity combined with context length limits creates degradation.

**How to avoid:**
Use structured delta summaries, not full reports, when passing state between rounds:

```
Round 1 result: 3/7 criteria passed. Failed: [list]. Builder fix: [one-line per fix]
Round 2 result: 5/7 criteria passed. Remaining failures: [list]. Do not change what passed.
```

The builder receives only the delta — what failed, what was fixed, what remains — not the full history. The GSD `execute-phase.md` already uses this pattern (spot-check summaries not full SUMMARY.md content) when passing wave completion context.

Cap the total context passed to the builder at round 3+ by evicting round 1 details. The builder only needs to know: current failures + what was tried and failed.

**Warning signs:**
- Builder in round 3 reverts a change made in round 2 that the evaluator had approved
- Builder output in round 3 is longer than round 1 despite having fewer failing criteria
- Builder asks clarifying questions about decisions it made in round 1

**Phase to address:**
Phase 1 (loop architecture). Define the delta summary format before implementing multi-round state passing.

---

### Pitfall 8: Design System Token Evaluation False Positives and False Negatives

**What goes wrong:**
The token audit script (`scripts/token-audit.js`) checks for hardcoded hex colors and arbitrary Tailwind color classes. It does not check semantic intent — whether the right semantic token is used for the right purpose. An evaluator running only the token audit gets false confidence:

**False negative (passes bad work):** The builder uses `bg-muted` where `bg-hub-card` is semantically correct for a protocol page. The token audit passes (no hardcoded hex, no `bg-[#xxx]`). The evaluator scores token compliance as PASS. The UI looks wrong on protocol pages.

**False positive (blocks good work):** The builder uses a valid shadcn component that internally uses Tailwind `bg-background` which the token audit flags as a potential warning. The evaluator interprets warnings as failures. The builder spends a round trying to fix something that is correct.

**Why it happens:**
The existing token audit is a syntactic check, not a semantic one. It works well as a human workflow tool (zero errors required before committing) but is poorly calibrated for autonomous evaluation where the distinction between errors (hard failures) and warnings (advisory) is critical.

**How to avoid:**
In autonomous evaluation, run the token audit with `--quiet` flag: `node scripts/token-audit.js --quiet`. This flags only errors (hardcoded colors), not warnings (hardcoded spacing, font sizes). Warnings are advisory for humans but should not block autonomous builds — spacing values are often correct and context-dependent.

For semantic correctness, the design system evaluation must be based on the component spec files in `specs/design-system/components/`, not on syntactic token checks alone. Evaluator criteria for UI phases should include: "Component X uses the hub-card surface as specified in specs/design-system/components/[component].md" as a direct file read check.

**Warning signs:**
- Token audit exits 1 due to warnings from third-party shadcn components, not builder-written code
- The evaluator's token compliance check and the builder's token audit run produce different results on the same build
- Token audit errors appear only in `app/api/og/` or `lib/monaco-theme.ts` (which are explicitly exempt per CLAUDE.md)

**Phase to address:**
Phase 2 (evaluation harness calibration). Distinguish error vs. warning modes in the evaluator rubric before any UI feature goes through the autonomous loop.

---

### Pitfall 9: GSD State Machine Diverges When Evaluator Adds a New Loop Between Pipeline Stages

**What goes wrong:**
The GSD system maintains state in `STATE.md` and `ROADMAP.md`. The existing `execute-phase.md` pipeline advances state on each plan completion. The autonomous build-evaluate loop adds new iteration cycles *within* a plan execution — the plan is "in progress" but neither complete nor failed from GSD's perspective while the build-evaluate loop is running. If the loop ends in escalation (round cap reached), the plan is in an ambiguous state: some work was done, some was not, `STATE.md` was not updated.

The SAFE-02 counter (2-round iteration limit) in the Blueprint pipeline and the round cap in the build-evaluate loop are two separate counters that are not coordinated. It is possible for the build-evaluate loop to consume its 2 rounds and escalate to the Blueprint pipeline's Debugger, which then gets its own 2 rounds, resulting in 4+ total rounds before human escalation — more than intended.

**Why it happens:**
The Blueprint pipeline was designed for synchronous lint/type-check/build failures that are deterministic and fast. The build-evaluate loop adds a new failure mode: runtime behavioral failures that are slower and probabilistic. The two iteration counters operate in the same pipeline without awareness of each other.

**How to avoid:**
The build-evaluate loop's round counter must be part of the Blueprint pipeline's SAFE-02 counter. When the evaluator rejects a build, this counts as a "verify-implement loop" rejection for SAFE-02 purposes. The Verifier agent's approval gate (SAFE-04) should be the signal that terminates the build-evaluate loop successfully — not a separate evaluator pass signal.

Treat the evaluator as an extended stage in the VERIFY phase, not a separate post-VERIFY system. The flow becomes: IMPLEMENT → EVALUATE (runtime) → VERIFY (static + runtime combined) → PR. The evaluator's runtime results feed into the Verifier's report, which triggers the existing SAFE-04 gate.

When escalating from the build-evaluate loop, write the escalation state to `STATE.md` before terminating. The escalation report should include: which evaluation criteria failed, what the builder tried, round numbers consumed. This gives the human reviewer enough context to continue without starting over.

**Warning signs:**
- `STATE.md` shows a plan as "in progress" 24 hours after autonomous mode started
- The Blueprint pipeline's Debugger is invoked for a failure that was actually a runtime evaluation failure (not a lint/type-check failure)
- SAFE-02 escalation report does not mention evaluation criteria — only lint/build results

**Phase to address:**
Phase 1 (loop integration design). Define how the build-evaluate round counter maps to SAFE-02 before any code is written.

---

### Pitfall 10: Worktree Port Conflicts When Build and Evaluate Run in Separate Worktrees

**What goes wrong:**
The target architecture uses `/superpowers` parallel agents with worktrees for build/evaluate isolation. Each worktree runs in its own directory. But `pnpm dev` in all worktrees defaults to port 3000. When the builder's worktree runs the dev server for smoke testing and the evaluator's worktree starts its own dev server for Playwright evaluation simultaneously, both attempt port 3000. Confirmed in production: git worktrees give code isolation, not port isolation. "When running multiple instances from different worktrees simultaneously, they fight over the same ports." (Microsoft Aspire blog, 2025)

Additionally, the `.env.local` file is gitignored — worktrees do not inherit it. The evaluator's worktree starts without database credentials and silently fails with a connection error that looks identical to a genuine application startup failure.

**Why it happens:**
Worktree isolation is a filesystem concept, not an environment isolation concept. When documentation says "worktrees isolate agents," it means git state isolation. Everything shared (ports, env files, database, Docker volumes) remains shared.

**How to avoid:**
Assign unique ports per evaluation context, not per worktree. Use a port allocation formula: `BASE_PORT + (ROUND_NUMBER * 10)`. Round 1 uses port 3000, round 2 uses 3010, etc. The `PORT` environment variable in `scripts/e2e-server.sh` must be set before starting `pnpm dev`. Playwright's `baseURL` config must reference the round-specific port.

For `.env.local`: create a startup check in the evaluator that verifies `DATABASE_URL` is set before starting the dev server. If missing, the evaluator reads from a known location (`.env.local` in the project root, not in the worktree directory) and copies it to the worktree. Document this as a required setup step.

For fully parallel build+evaluate in the same phase: use sequential evaluation (build in worktree, evaluate against the worktree's output, do not run both servers simultaneously). Parallelism is appropriate for multiple independent features evaluated in parallel, not for builder+evaluator running against each other.

**Warning signs:**
- `EADDRINUSE :::3000` in the evaluator when the builder's dev server is still running
- Playwright tests fail with "net::ERR_CONNECTION_REFUSED" because the evaluator's dev server never started
- Dev server output in the evaluator log shows Next.js auto-switching to port 3001 silently

**Phase to address:**
Phase 2 (worktree + server isolation). Configure port allocation and `.env.local` propagation before implementing parallel build/evaluate.

---

### Pitfall 11: HTTP API Assertions Against a Dev Server Catch Different Failures Than Production

**What goes wrong:**
The evaluator tests API endpoints against `pnpm dev` (Next.js development mode). Some failures that would appear in production are invisible in dev mode, and some dev-mode behaviors are absent in production:

- Next.js dev mode compiles routes on first request — the first HTTP assertion against a new route takes 2-8s and may timeout. The evaluator marks the endpoint as "unavailable" when it just needs more time.
- Dev mode error responses include full stack traces. Evaluator assertions that check error message format pass in dev but fail in production where stack traces are suppressed.
- Some Drizzle ORM query optimizations only run in production mode (with `NODE_ENV=production`). An evaluator that only tests in dev mode will not catch ORM issues that appear only in the production build.

**Why it happens:**
Running against the dev server is the path of least resistance — no build step required. But `pnpm dev` and `pnpm build && pnpm start` are meaningfully different environments for API testing.

**How to avoid:**
Run API assertions against the production build (`pnpm build && pnpm start`) rather than the dev server. The evaluator must include a production build step as part of its startup sequence.

If production build time is prohibitive (Next.js full build takes 45-90s for this codebase), run dev mode for Playwright UI tests but production mode for API assertion tests. The evaluator uses two different server configurations depending on the test type.

For the first-request cold-start issue: add a `warmup` step before any evaluator assertions. Send a single request to each route being tested and wait for 200 response before starting the timed evaluation.

**Warning signs:**
- HTTP assertion fails with 504 timeout on the first call to a new route but succeeds on the second call
- Error message format checks pass locally but fail in CI (CI uses different NODE_ENV)
- Evaluator reports API as "working" but manual testing against the deployed version shows failures

**Phase to address:**
Phase 2 (evaluation harness). Establish which test types use dev vs. production mode before writing any evaluator assertions.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use `pnpm dev` for all evaluation | No build step, faster loops | Catches different bugs than production; first-request timeouts; stack traces in error responses | Never for API assertions. Acceptable for UI-only Playwright tests |
| Single round cap (cap=1) | Cheapest per task | Builder only gets one attempt regardless of failure type; many fixable failures escalate to human | Only for Tier 1 pattern tasks with mechanical criteria only |
| Inline `pnpm dev` start in evaluator | Simpler implementation | Zombie processes on round N+1; no PID tracking; `EADDRINUSE` failures | Never — use dedicated server management script |
| Skip seed cleanup between rounds | Faster round startup | Seed contamination accumulates; tests that check counts fail after round 1 | Never — cleanup must be idempotent and run before every round |
| Subjective criteria in autonomous gate | Catches more issues | Self-evaluation bias inflates pass rates; criteria drift over time; humans can't reproduce failures | Never — subjective criteria go in `MANUAL_REVIEW_NEEDED` |
| Share SAFE-02 counter with evaluate rounds | Simpler implementation | Build-evaluate rounds and lint fix rounds are different things; mixing them obscures which failure type caused escalation | Acceptable if the counter tracks type separately |
| Run full Playwright suite per evaluation round | Maximum coverage | 5-15 minute test runs; flaky tests in unrelated areas block the feature; cost per round explodes | Never — scope tests with `@autonomous` tag to the feature being evaluated |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Playwright + autonomous loop | Running full suite per round | Tag feature-specific tests with `@autonomous`; run `--grep @autonomous` in evaluator |
| GSD STATE.md | Not writing state on mid-loop escalation | Write round number and last failing criteria to STATE.md before escalating; resumes without starting over |
| Blueprint SAFE-02 + evaluate rounds | Two separate counters not coordinated | Evaluate-rebuild rounds must count against SAFE-02's verify-implement loop counter |
| Next.js dev server + worktrees | Each worktree starts on port 3000 | Port formula: `3000 + (ROUND * 10)`; set `PORT` env var before `pnpm dev` |
| Seed cleanup between rounds | Relying on Playwright's lifecycle | Call `cleanupPersistentTestUsers` + `seedPersistentTestUsers` explicitly before each round |
| Token audit in evaluator | Running in default mode (errors + warnings) | Run `--quiet` flag (errors only) in autonomous gate; warnings are human advisory |
| HTTP assertions + dev mode cold start | First assertion triggers compilation, times out | Send warmup request to each route before timed assertions; wait for 200 |
| Evaluator + design system specs | Using token audit as proxy for spec compliance | Token audit = mechanical check; spec compliance = read the component spec and verify semantics |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full Next.js build per round | 45-90s per evaluation round; cost explodes | Use dev server for UI tests; only build for API assertion tests | Immediately — do not default to full build per round |
| Full Playwright suite per round | 5-15 minute evaluation; flaky tests in unrelated areas | Tag feature-specific tests; run tagged subset only | Every round — full suite is always wrong in autonomous mode |
| Reseeding full analytics data per round | Analytics seed is large (40 executions, 30 workflow executions, step logs) | Seed analytics data once per session, not per round; use `existing.length > 0` guard already in `seedAnalyticsData()` | After round 2 — analytics re-seed doubles data, breaks count assertions |
| Context accumulation in 3+ round loops | Builder spends most of context processing history, not building | Evict round N-2 details; pass only delta summaries | Round 3+ — context degradation compounds each round |
| Evaluator model at Opus for all rounds | 3x token cost vs. Sonnet for evaluation | Use Sonnet for mechanical checks; reserve Opus for final pass/fail judgment on subjective criteria only | At scale — cost per autonomous task becomes prohibitive |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Passing `.env.local` contents between worktrees by embedding in evaluator prompt | API keys and DB credentials in Claude context | Copy file directly (filesystem level); never read `.env.local` into any agent prompt |
| Seeding evaluator test users with production-pattern emails | Test users accidentally created in staging if evaluator points to wrong environment | Use clearly synthetic email domains (`.test` TLD) in evaluator-specific seed scripts; never reuse production email patterns |
| Build-evaluate loop auto-merging PRs without human sign-off | Incorrect behavior ships automatically | Evaluator approval gates Verifier approval; Verifier approval gates PR creation; PR merge always requires human (existing SAFE-04 behavior must not change for evaluate-add) |
| Evaluator writing diagnostic output to stdout when running in MCP server context | Corrupts MCP stdio protocol (same issue as Pitfall 2 from v1.5 PITFALLS.md) | All evaluator output to stderr; only structured pass/fail results to stdout |

---

## "Looks Done But Isn't" Checklist

- [ ] **Dev server lifecycle:** Run `scripts/e2e-server.sh start`, then `scripts/e2e-server.sh stop`, then `scripts/e2e-server.sh start` again — second start must succeed without `EADDRINUSE`. Verify by checking that round 2 evaluations do not fail at server startup.
- [ ] **Seed isolation:** Run two consecutive evaluation rounds without any builder changes. Verify that entity counts in the DB at the start of round 2 match counts at the start of round 1 (cleanup worked). Verify test pass/fail rates are identical (no contamination).
- [ ] **Round cap enforcement:** Configure `cap=2`. Create a feature that deliberately fails all evaluation criteria. Verify the loop escalates to human after exactly 2 rounds — not 1, not 3. Verify STATE.md contains the round count and last failing criteria.
- [ ] **Token audit mode:** Run `node scripts/token-audit.js` (default) and `node scripts/token-audit.js --quiet` against a shadcn component. Verify `--quiet` produces fewer (or zero) exit-1 outcomes for the same input.
- [ ] **Criterion locking:** Run evaluation round 1 where criteria A, B, C pass and D, E fail. In round 2, run the evaluator without changing anything. Verify it does not re-check A, B, C — only D and E are evaluated. Verify A, B, C remain marked PASS.
- [ ] **Port allocation:** Start two evaluation rounds simultaneously. Verify round 1 uses port 3000 and round 2 uses port 3010. Verify Playwright's `baseURL` references the correct port in each round.
- [ ] **Self-eval bias check:** Take a build that a human reviewer would rate as "incomplete but plausible." Run it through the evaluator. Verify at least one purely mechanical criterion (token audit, HTTP 200, pnpm check) is present and produces a FAIL for the incomplete build.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Zombie port 3000 from previous round | LOW | `lsof -ti:3000 \| xargs kill -9`; restart evaluation round; no code changes needed |
| Seed contamination discovered mid-loop | LOW | Run `cleanupPersistentTestUsers` manually; re-run round from start; no code changes |
| Infinite fix loop (4+ rounds before caught) | MEDIUM | Diff from round 1 to current; identify contradictory changes; revert to round 1 state; fix manually |
| Evaluator calibration drift identified | MEDIUM | Add calibration fixture for the discovered failure mode; re-run the evaluator on last 5 completed builds; verify no retroactive misclassifications |
| GSD STATE.md left in ambiguous state after loop escalation | LOW | Manually update STATE.md `Current Position` and `Status` fields; note round count in Pending Todos; resume from last clean plan |
| Evaluator approved work that human reviewer found broken | HIGH | Identify which criterion should have caught the issue; make it mechanical (command exit code) instead of judgmental; add to calibration fixtures |
| Worktree missing `.env.local` | LOW | Copy from project root: `cp /main-checkout/.env.local ./`; restart dev server |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Self-evaluation bias (same-model judge) | Phase 1: Evaluator design | All criteria are command exit codes or HTTP status codes; no subjective criteria in gate |
| Playwright flakiness false negatives/positives | Phase 2: Playwright harness | `--retries=2` in evaluator Playwright config; `@autonomous` tag on relevant tests; test passes on 3 consecutive runs without code changes |
| Dev server zombie processes | Phase 2: Server lifecycle | `e2e-server.sh stop` followed by `e2e-server.sh start` succeeds on port 3000 without error |
| Infinite fix-evaluate loops | Phase 1: Loop architecture | Round cap wired to SAFE-02 counter; convergence check halts identical-failure rounds immediately |
| Evaluator calibration drift | Phase 1 design + Phase 3 calibration | 5 calibration fixtures produce expected verdicts after any evaluator prompt change |
| Seed contamination between rounds | Phase 2: Seed lifecycle | Two consecutive rounds without builder changes produce identical test pass rates |
| Context window degradation | Phase 1: Loop architecture | Builder receives delta summary (not full history) at round 3; total context passed is bounded |
| Token audit false positives | Phase 2: Evaluation harness | Evaluator runs `--quiet` flag; shadcn components do not cause exit-1 |
| GSD state machine divergence | Phase 1: Loop integration | Build-evaluate round count is exposed in STATE.md and in SAFE-02 escalation report |
| Worktree port conflicts | Phase 2: Worktree isolation | Parallel evaluation rounds use different ports; `EADDRINUSE` does not appear in any round N+1 log |
| Dev vs. production API differences | Phase 2: Evaluation harness | API assertions run against `pnpm build && pnpm start` output; first-request warmup step present |

---

## Sources

- [AWS blog: Real-world lessons from evaluating AI agents at Amazon](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-real-world-lessons-from-building-agentic-systems-at-amazon/)
- [Arxiv: Play Favorites — Statistical Method to Measure Self-Bias in LLM-as-a-Judge](https://arxiv.org/abs/2508.06709)
- [Anthropic alignment blog: Building and evaluating alignment auditing agents](https://alignment.anthropic.com/2025/automated-auditing/)
- [Medium (Micheal Lanham): Your LLM Evaluator Is Lying to You — Prompt Calibration and Kappa Metrics](https://medium.com/@Micheal-Lanham/your-llm-evaluator-is-lying-to-you-how-to-fix-it-with-prompt-calibration-and-kappa-metrics-29d4a7ae397c)
- [Tech Startups: AI Agents Horror Stories — $47,000 AI Agent Failure](https://techstartups.com/2025/11/14/ai-agents-horror-stories-how-a-47000-failure-exposed-the-hype-and-hidden-risks-of-multi-agent-systems/)
- [ZenML blog: What 1,200 Production Deployments Reveal About LLMOps in 2025](https://www.zenml.io/blog/what-1200-production-deployments-reveal-about-llmops-in-2025)
- [Agent Patterns: Infinite Agent Loop failure mode](https://www.agentpatterns.tech/en/failures/infinite-loop)
- [Blake Crosley: The Forgetting Agent — Why Multi-Turn Conversations Collapse](https://blakecrosley.com/blog/agent-memory-degradation)
- [BetterStack: Avoiding Flaky Tests in Playwright](https://betterstack.com/community/guides/testing/avoid-flaky-playwright-tests/)
- [TestDino: Playwright Test Failure Analysis — 45% are async wait issues](https://testdino.com/blog/playwright-test-failure/)
- [Medium (Feb 2026): Why Your Playwright Tests Are Still Flaky — It's Not Timing](https://medium.com/codetodeploy/why-your-playwright-tests-are-still-flaky-and-its-not-because-of-timing-9c005d0e83a3)
- [vercel/next.js Issue #58184: next dev keeps occupying port after being stopped](https://github.com/vercel/next.js/issues/58184)
- [Microsoft Aspire blog: Scaling AI Agents — port isolation for parallel worktrees](https://devblogs.microsoft.com/aspire/scaling-ai-agents-with-aspire-isolation/)
- [DEV Community: Claude Code Loves Worktrees, Your Infrastructure Doesn't](https://dev.to/augusto_chirico/claude-code-loves-worktrees-your-infrastructure-doesnt-kfi)
- KeeperHub codebase: `.claude/agents/blueprint-pipeline.md` — SAFE-02 iteration limit specification
- KeeperHub codebase: `tests/e2e/playwright/global-setup.ts` and `utils/seed.ts` — existing seed/cleanup lifecycle
- KeeperHub codebase: `tests/e2e/playwright/CLAUDE.md` — test patterns and selector conventions
- KeeperHub `.planning/PROJECT.md` v1.6 — autonomous build-evaluate loop target features

---
*Pitfalls research for: KeeperHub v1.6 Autonomous Build-Evaluate Loop*
*Researched: 2026-03-29*
