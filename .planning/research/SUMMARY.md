# Project Research Summary

**Project:** KeeperHub v1.6 — Autonomous Build-Evaluate Loop
**Domain:** Runtime evaluation layer integrated into existing GSD agent pipeline
**Researched:** 2026-03-29
**Confidence:** HIGH

## Executive Summary

KeeperHub v1.6 adds an autonomous build-evaluate loop to the existing GSD pipeline: after a builder agent implements a feature, a new evaluator agent starts a live dev server, seeds test data, runs Playwright UI tests and HTTP assertions, and scores the result against the plan's success criteria. If the score falls below threshold, structured gaps are fed back to the builder for a fix round, up to a configurable cap. This is the pattern Anthropic's harness research identifies as the primary mechanism for catching behavioral failures that static checks (lint, type-check, build) cannot detect.

The implementation requires zero new npm packages. Every required primitive — Playwright webServer config, APIRequestContext, JSON reporter, Vercel AI SDK `Output.object()`, Zod v4, tsx — is already installed. The milestone is entirely new TypeScript scripts and agent markdown files wired together from existing dependencies. The new `gsd-evaluator` agent sits between the existing `execute-phase` and `gsd-verifier` stages, fires conditionally when an `EVAL-CONFIG.yml` is present in the phase directory, and communicates results exclusively through file-based `EVAL.md` reports — consistent with how all existing GSD agents communicate.

The critical risk is not technical complexity but evaluation quality. Three patterns dominate failure in autonomous build-evaluate loops at production scale: (1) self-evaluation bias when the same model family both builds and judges — neutralized by making every gate criterion a deterministic command exit code rather than a subjective LLM judgment; (2) dev server process leakage between rounds — neutralized by using Playwright's built-in `webServer` config instead of manual process management; and (3) convergence failures where the loop fixes one criterion and breaks another indefinitely — neutralized by locking passed criteria and tying the round counter to the existing SAFE-02 limit. The architecture is designed around these three mitigations from the start.

## Key Findings

### Recommended Stack

All required technology is already installed. The v1.6 milestone introduces no new dependencies. New source files wire existing packages in new configurations: a second `playwright.evaluate.config.ts` with `webServer` block and JSON reporter isolated from the existing `playwright.config.ts`; `scripts/evaluate/score.ts` for weighted criterion scoring using Zod v4; `scripts/evaluate/criteria-scorer.ts` for LLM-graded visual evaluation using AI SDK v5 `Output.object()` pattern; and a new `evaluator` agent definition following the existing `.claude/agents/` format.

**Core technologies (existing, newly applied):**
- `@playwright/test` webServer config: manages dev server lifecycle (start, health poll, graceful stop) — eliminates zombie process risk vs manual `child_process.spawn()`
- `@playwright/test` APIRequestContext: HTTP assertions with unified auth state — no axios or supertest needed
- `@playwright/test` JSON reporter: machine-readable pass/fail output at `.claude/eval-results.json` for the scorer to consume
- `ai` v5 `Output.object()`: structured LLM scoring for visual/UX criteria Playwright cannot assert — verify import: `import { generateText, Output } from 'ai'` (not top-level `generateObject`)
- `zod` v4: `EvalScoreSchema`, `CriterionResultSchema`, LLM output validation — use v4 API only (breaking differences from v3)
- `tsx`: runs `scripts/evaluate/*.ts` outside the Playwright runner
- `git worktree` (builtin): filesystem isolation for parallel build/evaluate; Claude Code v2.1.49+ supports natively

**Critical version note:** AI SDK v5 changed from top-level `generateObject` to `generateText({ output: Output.object({...}) })`. Verify the export exists before implementing `criteria-scorer.ts`. Zod v4 `^4.3.6` is already in use across the codebase — do not mix v3 syntax.

### Expected Features

**Must have — v1 working loop:**
- Dev server lifecycle management: start, health-check, teardown; port 3099 (not 3000) to avoid collision with developer's running instance
- Test data seeding via existing `scripts/seed/` invoked in deterministic order per round
- Per-criterion PASS/FAIL scoring: each Task Brief success criterion independently graded with evidence
- HTTP assertion-based API evaluation against running server (status codes, response shapes, DB side effects)
- Playwright UI evaluation via scenario-scoped tests using existing auth/workflow helpers
- Structured EVAL_REPORT with `APPROVED: true/false` — same boolean gate as Verifier report
- Round cap (default 3, configurable) with human escalation after cap
- Runtime Evaluator agent (`gsd-evaluator`) — strictly independent from builder, tools: Read, Write, Bash, Grep, Glob
- `/gsd:build-evaluate` slash command as the full-cycle entry point

**Should have — v1.x calibrated loop (add after v1 validates):**
- Sprint contract negotiation: evaluator reviews PLAN.md criteria before builder runs to make them testable — prevents grading what was built rather than what was intended
- Calibrated per-dimension scoring rubric: functionality / correctness / UI token compliance / API contract — prevents single-dimension failures being masked by aggregate PASS
- UI evaluation against design-system specs: screenshot + LLM rubric against `specs/design-system/`
- `/code-review` as pre-evaluation gate: filters code quality issues before runtime testing begins
- `evaluate-after-build` step wired into `execute-phase` as automatic when PLAN.md has `evaluate: true`

**Defer to v2+:**
- Worktree isolation for build/evaluate parallelism (only needed when multiple features build simultaneously)
- Full playwright-cli live interaction beyond probe
- Pass@k tracking across multiple evaluation trials

**Anti-features to reject regardless of request:**
- Full Playwright suite execution per evaluation round: turns every round into a 5-15 minute blocking operation
- Persistent dev server across rounds: stale seed data produces false positives
- Pixel-diff visual regression testing: false positives on every font rendering variation; use LLM rubric instead
- Agent self-evaluation: builder cannot reliably grade its own output; evaluator must be strictly independent

### Architecture Approach

The evaluator fits into the existing GSD pipeline as a conditional post-wave gate inserted between `execute_waves` and `regression_gate`. The gate fires only when `EVAL-CONFIG.yml` is present in the phase directory, preserving full backward compatibility for phases that do not need runtime evaluation. All communication between the orchestrator and evaluator is file-based: orchestrator writes `EVAL-CONFIG.yml` at plan time; evaluator reads it and writes `EVAL.md` results; orchestrator reads `EVAL.md` for routing. This mirrors the existing executor-to-verifier communication pattern exactly.

**Major components:**
1. `gsd-evaluator` agent (`~/.claude/agents/gsd-evaluator.md`) — starts dev server, seeds data, runs Playwright + HTTP assertions, scores, writes EVAL.md
2. `EVAL-CONFIG.yml` per-phase file — authored by planner; declares criteria, thresholds, server port, seed scripts; presence/absence gates whether evaluation runs
3. `EVAL.md` per-phase file — YAML frontmatter (status, score, round, gaps array) + markdown body with criterion-by-criterion results and fix hints
4. `runtime_evaluation_gate` step in `execute-phase.md` — detects EVAL-CONFIG.yml, spawns evaluator via Task(), reads EVAL.md status, loops or continues
5. `build-evaluate.md` slash command — standalone orchestration of full build-evaluate-fix cycle for a single phase
6. Two-layer scoring: Layer 1 `scripts/evaluate/score.ts` (deterministic, Zod-validated, zero LLM cost) + Layer 2 `scripts/evaluate/criteria-scorer.ts` (LLM rubric, only for criteria Playwright cannot assert)

**Key patterns:**
- Eval config as phase artifact: planner writes config during `plan-phase`, forcing testability to be considered at design time
- Round-preserving history: first round writes `EVAL.md`, subsequent rounds write `EVAL-ROUND-2.md`, `EVAL-ROUND-3.md`; orchestrator reads latest, full history preserved for debugging
- Criteria inheritance fallback: if no EVAL-CONFIG.yml, evaluator auto-derives criteria from PLAN.md `success_criteria` frontmatter with `confidence: low` marking
- Playwright test reuse via grep filter: evaluator runs existing E2E tests filtered by `@autonomous` tag rather than writing new tests per evaluation

### Critical Pitfalls

1. **Self-evaluation bias (same-model judge)** — Evaluator is Claude Sonnet; builder is Claude Sonnet. Published research shows same-model evaluation has near-random correlation with independent judgment on the builder's own output. Prevention: every gate criterion must be a command exit code or observable HTTP state assertion, never a subjective judgment call. Move irreducibly subjective criteria to `MANUAL_REVIEW_NEEDED`. Use Opus as evaluator if budget allows.

2. **Dev server zombie processes block port between rounds** — `next dev` spawns worker processes that do not terminate cleanly when the parent receives SIGTERM. Confirmed open issue (vercel/next.js#58184): ~40% chance of `EADDRINUSE` on round N+1 without explicit cleanup. Prevention: use Playwright's built-in `webServer` config with `reuseExistingServer: false`, which handles full lifecycle correctly. Never use inline `pnpm dev &` in the evaluator.

3. **Infinite fix-evaluate loops from non-convergent failures** — Builder fixes criterion A; evaluator finds new failure in criterion B. Loop never shrinks. A production incident ran 11 days and cost $47,000 without a convergence check. Prevention: lock criteria that pass — subsequent rounds evaluate only previously-failing criteria. Implement convergence check: identical failure sets across two rounds trigger immediate escalation. Build-evaluate round count feeds into the existing SAFE-02 counter, not a separate uncoordinated counter.

4. **Seed data contamination between rounds** — Round 1 seeds DB; Round 2 evaluator re-seeds on top; tests checking entity counts fail. Prevention: run explicit `cleanupPersistentTestUsers` + `seedPersistentTestUsers` before each round (do not rely on Playwright's session lifecycle). Use unique per-round identifier prefixes. Halt and escalate rather than proceeding with contaminated data.

5. **Playwright flakiness false negatives/positives** — Async wait races (~45% of UI test failures per production data) cause good builds to fail; selector drift from AI-generated code causes bad builds to pass. Prevention: run with `--retries=2` in autonomous mode; tag feature-specific tests with `@autonomous` and only run tagged tests; pre-check that `data-testid` attributes referenced in tests are present in built source before running.

6. **Context window degradation in multi-round loops** — By round 3, builder context contains original plan + two sets of implementation and evaluation reports. Builder makes contradictory edits attending to stale evaluation comments. Prevention: pass delta summaries between rounds (what failed, what was fixed, what remains), not full reports; evict round N-2 details at round 3+.

## Implications for Roadmap

The build-order dependencies from ARCHITECTURE.md and the pitfall-to-phase mapping from PITFALLS.md point to a clear sequencing. The three critical pitfalls (self-eval bias, zombie processes, infinite loops) are all architectural decisions that must be made before any implementation begins — they cannot be retrofitted without a full rewrite of the loop logic.

### Phase 1: Loop Architecture and Evaluator Agent Foundation

**Rationale:** The most expensive pitfalls — infinite loops, GSD state divergence, context degradation, self-eval bias — are architectural decisions that cannot be retrofitted once the loop is running. Phase 1 establishes the non-negotiable constraints and communication contracts before any code executes.

**Delivers:**
- `gsd-evaluator.md` agent definition (tools, model, isolation, strictly read-only perspective on builder output)
- EVAL.md file format specification with YAML frontmatter schema (status, score, round, max_rounds, gaps array)
- EVAL-CONFIG.yml format specification (threshold, max_rounds, server_port, seed_scripts, criteria list)
- Round cap wired to SAFE-02 counter: build-evaluate rounds count against the same limit as lint/type-check fix rounds
- Criterion locking rule: passed criteria are not re-checked in subsequent rounds; only previously-failing criteria are re-evaluated
- Convergence check: identical failure sets across two consecutive rounds trigger immediate escalation
- Delta summary format for inter-round state passing (not full report history in builder context)
- Criterion classification rule: all autonomous gate criteria must be command exit codes or HTTP status assertions; subjective criteria go to `MANUAL_REVIEW_NEEDED`

**Addresses:** Runtime Evaluator agent definition, round cap design, loop termination guarantees
**Avoids:** Self-evaluation bias (Pitfall 1), infinite fix-evaluate loops (Pitfall 4), context window degradation (Pitfall 7), GSD state machine divergence (Pitfall 9)

### Phase 2: Dev Server Lifecycle and Evaluation Harness

**Rationale:** Every runtime test requires a reliably running server. Seed contamination, port conflicts, Playwright flakiness, and token audit false positives must all be solved before any evaluation runs produce meaningful results. This phase establishes the reliability guarantees that make scoring trustworthy.

**Delivers:**
- `playwright.evaluate.config.ts` with `webServer` block (port 3099, `reuseExistingServer: false`, `retries: 0`, JSON reporter to `.claude/eval-results.json`)
- Per-round seed lifecycle: explicit `cleanupPersistentTestUsers` + `seedPersistentTestUsers` before each round with count-verification
- `@autonomous` test tagging convention + grep filter in evaluator config (not full suite)
- Token audit invoked with `--quiet` flag (errors only, not warnings) for autonomous gate
- Port allocation formula for parallel evaluation contexts: `3099 - AGENT_INDEX`
- `.env.local` propagation check for worktree contexts (copy from project root if missing)
- Decision documented: UI tests run against dev server; API assertions run against production build (`pnpm build && pnpm start`) to avoid dev-mode cold-start timeouts and stack trace format differences
- Warmup step before timed HTTP assertions (prevents first-request compilation timeout)

**Addresses:** Dev server lifecycle management, test data seeding, Playwright UI evaluation, HTTP API evaluation, design token audit
**Avoids:** Zombie processes (Pitfall 3), seed contamination (Pitfall 6), Playwright flakiness (Pitfall 2), token audit false positives (Pitfall 8), dev vs. production API differences (Pitfall 11), port conflicts (Pitfall 10)

### Phase 3: Scoring, EVAL.md Output, and Gap Closure

**Rationale:** With the evaluator running reliably, the scoring and gap-to-fix-task pipeline can be built on solid ground. This phase closes the loop: evaluator output drives fix task generation through the existing planning infrastructure without modifying that infrastructure.

**Delivers:**
- `scripts/evaluate/score.ts` — reads Playwright JSON reporter output, computes weighted criterion scores, writes `EvalScoreSchema`-validated `.claude/eval-score.json`; hard threshold rule: any criterion below its individual threshold fails the round regardless of total score
- `scripts/evaluate/criteria-scorer.ts` — LLM rubric scoring using AI SDK v5 `Output.object()`; invoked only after all deterministic checks pass; only for criteria Playwright cannot assert
- `scripts/evaluate/seed-eval.ts` — seeds minimal test data for evaluation context
- EVAL.md writer: structured YAML frontmatter + criterion results table + gap detail with fix hints per failing criterion
- Round-preserving file naming: `EVAL.md`, `EVAL-ROUND-2.md`, `EVAL-ROUND-3.md`
- `plan-phase --eval-gaps` variant: reads EVAL.md gaps array to generate fix plans (same mechanism as `--gaps` reads VERIFICATION.md)
- `package.json` scripts: `eval`, `eval:score`, `eval:seed`

**Addresses:** Per-criterion PASS/FAIL scoring, structured EVAL_REPORT with `APPROVED: true/false`, gap closure loop
**Avoids:** Evaluator calibration drift (Pitfall 5) by enforcing mechanical-first criteria in all scoring logic

### Phase 4: execute-phase Integration

**Rationale:** The highest-risk change because it modifies an existing workflow. Must be additive and conditional to preserve full backward compatibility. Depends on Phases 1-3 being solid and independently tested. The conditional gate design means zero impact on all existing phases.

**Delivers:**
- `runtime_evaluation_gate` step added to `execute-phase.md` (after post-wave hooks, before regression_gate)
- EVAL-CONFIG.yml presence detection: gate is skipped entirely for phases without the config file
- Evaluator subagent spawn via `Task()` with worktree path and port assignment
- Round loop logic: read EVAL.md status then continue / retry / escalate based on score and round count
- STATE.md update on escalation: round count, last failing criteria, work completed
- `autonomous.md` post-execution routing updated to handle eval gap closure alongside existing VERIFICATION.md gap closure

**Addresses:** Evaluate-after-build step in execute-phase, /gsd:autonomous integration
**Avoids:** GSD state divergence (Pitfall 9) by writing STATE.md before escalating; backward compatibility preserved by conditional gate

### Phase 5: Build-Evaluate Command and Calibration

**Rationale:** With the full pipeline running end-to-end, the standalone command provides a simpler entry point for running the build-evaluate cycle without the full autonomous pipeline. Calibration fixtures created from real Phase 3-4 evaluation runs lock in evaluation quality and provide a regression harness for evaluator prompt changes.

**Delivers:**
- `/gsd:build-evaluate` slash command: orchestrates full build-evaluate-fix cycle for single phase with `--max-rounds N` and `--phase <N>` flags; wraps seed, dev server, builder, evaluator, gap closure
- 5 calibration fixtures based on real examples from Phases 3-4: golden inputs with known correct pass/fail verdicts
- Classification of all criteria in pilot phases as mechanical vs. judgmental; judgmental criteria moved to `MANUAL_REVIEW_NEEDED` where found

**Addresses:** `/gsd:build-evaluate` command, evaluator calibration
**Avoids:** Calibration drift (Pitfall 5) by providing regression fixtures

### Phase Ordering Rationale

- Phase 1 must precede everything: the three critical architectural decisions (criterion format, round cap coordination, convergence rule) cannot be added after the loop is running without a full rewrite
- Phase 2 must precede Phase 3: scoring is meaningless if server lifecycle and seed isolation are not reliable; unreliable test execution produces unreliable scores
- Phase 3 must precede Phase 4: the `runtime_evaluation_gate` in execute-phase depends on EVAL.md format and scorer being ready to produce results
- Phase 4 is the highest-risk change (modifying execute-phase.md); all prerequisites must be tested in isolation before integration to minimize the blast radius if modifications are needed
- Phase 5 is purely additive: the command wraps what Phase 4 provides; calibration fixtures can only be created from real evaluation runs

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (execute-phase integration):** The exact mechanism for coordinating the build-evaluate round counter with SAFE-02 needs validation against the current `blueprint-pipeline.md` implementation. Read the current SAFE-02 counter field name and increment logic before writing the integration step to avoid creating a parallel uncoordinated counter.
- **Phase 3 (AI SDK v5 `Output` import):** Verify the exact import path (`import { generateText, Output } from 'ai'` vs. `ai/core`) against the installed v5.0.157 before implementing `criteria-scorer.ts`. Run `node -e "const {Output} = require('ai'); console.log(typeof Output)"` in the project to confirm.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Playwright webServer config):** Fully documented official API; config is a copy-and-modify of existing `playwright.config.ts` structure with known options.
- **Phase 3 (score.ts):** 50 lines of Zod v4 + `node:fs`; no research needed.
- **Phase 5 (slash command):** Follows exact pattern of existing GSD commands in `.claude/get-shit-done/commands/gsd/`.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages directly inspected in codebase. No new dependencies. Version compatibility verified against official docs. One point to verify: AI SDK v5 `Output` export path at runtime. |
| Features | HIGH | Existing infrastructure deeply understood from codebase inspection. Decision to defer sprint contracts and worktree parallelism to v1.x reduces the uncertainty scope to the MVP loop only. |
| Architecture | HIGH | Based on direct inspection of execute-phase.md, autonomous.md, gsd-verifier.md, gsd-executor.md, global-setup.ts, seed utilities. All integration points are known. |
| Pitfalls | HIGH | Self-eval bias backed by published Arxiv research. Zombie processes backed by confirmed open Next.js issue (#58184). Cost explosion backed by documented $47K incident. Playwright flakiness backed by production-scale data (45% of failures are async waits). |

**Overall confidence:** HIGH

### Gaps to Address

- **AI SDK v5 `Output` import path (Phase 3):** Verify the named export exists at `'ai'` top level before implementing `criteria-scorer.ts`. If not present, check `'ai/core'` or `'@ai-sdk/core'`. One-line check: `node -e "const {Output} = require('ai'); console.log(typeof Output)"`.

- **SAFE-02 counter coordination (Phase 4):** Read the current field name and increment logic for the SAFE-02 counter in `blueprint-pipeline.md` before writing the `runtime_evaluation_gate` integration. The counter must track build-evaluate rounds alongside lint/type-check rounds without conflating the two failure types.

- **First-round pass rate baseline (Phase 5 calibration):** No empirical data exists on what a reasonable first-round evaluator pass rate should be for KeeperHub features. After the first 5 evaluation runs in Phases 3-4, establish a baseline. Calibration fixtures in Phase 5 provide the measurement mechanism. Target range from research: 50-70% first-round pass rate indicates well-calibrated criteria (not too easy, not too strict).

## Sources

### Primary (HIGH confidence)
- [playwright.dev/docs/test-webserver](https://playwright.dev/docs/test-webserver) — webServer config options, lifecycle, reuseExistingServer
- [playwright.dev/docs/api-testing](https://playwright.dev/docs/api-testing) — APIRequestContext HTTP assertions
- [playwright.dev/docs/test-reporters](https://playwright.dev/docs/test-reporters) — JSON reporter format and output file configuration
- [ai-sdk.dev/docs/ai-sdk-core/generating-structured-data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data) — AI SDK v5 Output.object() pattern with Zod
- KeeperHub codebase direct inspection: `playwright.config.ts`, `package.json`, `.claude/agents/`, `scripts/seed/`, `tests/e2e/playwright/global-setup.ts`, `specs/design-system/`, `scripts/token-audit.js`
- [vercel/next.js Issue #58184](https://github.com/vercel/next.js/issues/58184) — zombie port issue in `next dev`
- [Arxiv: Statistical Method to Measure Self-Bias in LLM-as-a-Judge](https://arxiv.org/abs/2508.06709) — same-model evaluation bias, Spearman correlation data
- [Tech Startups: $47,000 AI Agent Failure](https://techstartups.com/2025/11/14/ai-agents-horror-stories-how-a-47000-failure-exposed-the-hype-and-hidden-risks-of-multi-agent-systems/) — infinite loop cost explosion

### Secondary (MEDIUM confidence)
- [Anthropic: Harness design for long-running agentic applications](https://www.anthropic.com/engineering/harness-design-long-running-apps) — generator-evaluator separation, sprint contracts, Playwright MCP for live app interaction
- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — code-based vs model-based vs human graders, pass@k, isolated environment requirement
- [TestDino: 45% of Playwright failures are async wait issues](https://testdino.com/blog/playwright-test-failure/) — flakiness base rate data
- [Blake Crosley: The Forgetting Agent](https://blakecrosley.com/blog/agent-memory-degradation) — multi-turn context degradation failure mode
- [ZenML: What 1,200 Production Deployments Reveal About LLMOps](https://www.zenml.io/blog/what-1200-production-deployments-reveal-about-llmops-in-2025) — calibration drift in production evaluators
- [Martin Fowler: How far can we push AI autonomy in code generation?](https://martinfowler.com/articles/pushing-ai-autonomy.html) — runtime verification as the distinguishing factor between static and behavioral correctness

### Tertiary (LOW confidence)
- [claudefa.st: Claude Code v2.1.49 native worktree support](https://claudefa.st/blog/guide/development/worktree-guide) — consistent with multiple sources but third-party blog
- [Microsoft Aspire blog: port isolation for parallel worktrees](https://devblogs.microsoft.com/aspire/scaling-ai-agents-with-aspire-isolation/) — worktree port conflict confirmation

---
*Research completed: 2026-03-29*
*Ready for roadmap: yes*
