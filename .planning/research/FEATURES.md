# Feature Research

**Domain:** Autonomous build-evaluate loop for AI agent development pipeline (KeeperHub v1.6)
**Researched:** 2026-03-29
**Confidence:** HIGH (existing infrastructure deeply understood); MEDIUM (runtime evaluation integration patterns — emerging space)

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are the minimum features that make "autonomous build-evaluate" meaningful. Without them the loop is still manual or the evaluation is static-only (which already exists via the Verifier agent).

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Dev server lifecycle management | The evaluator cannot test what it cannot reach. Starting and stopping `pnpm dev` is the prerequisite for every runtime check | MEDIUM | Port conflict detection, process health check, graceful teardown; must not leave orphaned processes between runs |
| Test data seeding before evaluation | Evaluation against an empty DB produces false negatives. Seed scripts already exist at `scripts/seed/` — the evaluator needs to invoke them deterministically | LOW | Invoke existing `seed-user.ts`, `seed-test-workflow.ts`, `seed-test-wallet.ts` in a fixed order; skip seeds that conflict with existing data |
| Playwright-based UI evaluation | The primary UI verification mechanism already used by the project. Runtime browser testing is the only reliable way to validate what the Builder produced actually renders and works | MEDIUM | Reuse existing auth helpers, workflow helpers, and discover CLI; evaluator writes scenario-scoped test scripts, not a full suite |
| HTTP assertion-based API evaluation | API endpoints must be tested with real HTTP calls against the running server, not static code analysis. The Verifier already checks lint/type-check; the runtime evaluator checks behavior | MEDIUM | `curl` or `fetch` against `localhost:3000`; assert status codes, response shapes, and DB side effects via existing seed utilities |
| Per-criterion PASS/FAIL scoring | Each success criterion from the Task Brief must produce an independent scored verdict, not a single aggregate. This mirrors the existing Verifier report format and is required for targeted fix feedback | LOW | Each criterion: PASS / FAIL / MANUAL_REVIEW_NEEDED with evidence; no aggregation that hides individual failures |
| Structured evaluation report | The evaluator's output must be machine-readable so the orchestrator can route failures back to the Builder. Mirrors the existing Verification Report format | LOW | EVAL_REPORT with APPROVED: true/false field in the same format as the Verifier report; Orchestrator reads the same boolean gate |
| Round cap with escalation | Infinite retry loops are the primary failure mode of autonomous agents. A configurable cap (default 3 rounds) with human escalation after the cap is hit | LOW | Already enforced by SAFE-02 (2-round limit on implement-verify); the runtime evaluation loop adds a separate QA round counter on top |

### Differentiators (Competitive Advantage)

These features distinguish a genuine build-evaluate loop from merely "running tests after build." They are what the Anthropic harness article identifies as the high-value patterns that prevent agent self-praise bias.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Sprint contract negotiation (pre-build) | Generator and evaluator agree on testable success criteria before implementation begins, not after. This is the single pattern the Anthropic harness article identifies as most preventing rework. Without this, the evaluator grades what was built rather than what was intended | HIGH | New `/gsd:execute-phase` step: spawn evaluator agent before Builder to review PLAN.md criteria and make them Playwright/HTTP-testable; evaluator proposes concrete test scenarios; Builder implements against agreed criteria |
| Calibrated per-dimension scoring rubric | Binary PASS/FAIL on the whole feature masks which dimension failed. A 4-dimension rubric (functionality, correctness, UI token compliance, API contract) with per-dimension PASS/FAIL lets the Builder fix the specific failure without re-implementing the whole feature | MEDIUM | Dimensions map to what already exists: functionality (Playwright), correctness (HTTP assertions), UI quality (design token compliance from `specs/design-system/`), API contract (success criteria from Task Brief) |
| UI evaluation graded against design-system specs | The existing gsd-ui-auditor does static code analysis. The runtime evaluator screenshots live rendered components and grades them against `specs/design-system/tokens.css` and component specs. Pixel-level issues only visible at runtime | HIGH | Screenshot-to-spec comparison using playwright-cli `screenshot` command + LLM-graded rubric against `specs/design-system/` token semantics; feeds back to Builder as "token violation at component X" |
| Evaluator uses playwright-cli for live interaction | The evaluator navigates the running app like a real user, not just asserting DOM state. This catches race conditions, loading states, and interaction flows that static test assertions miss. Pattern directly from the Anthropic harness article: the evaluator "click[s] through running applications like end users" | HIGH | Evaluator agent has playwright-cli skill; executes discovery-first workflow (probe, highlight, interact) before asserting outcomes |
| Evaluate-after-build step wired into /gsd:execute-phase | Runtime evaluation must be an automatic phase gate, not an optional manual command. The existing execute-phase workflow runs IMPLEMENT then VERIFY (static). Adding evaluate-after-build as an automatic step after IMPLEMENT closes the loop without user intervention | MEDIUM | New optional flag `--evaluate` on execute-phase OR automatic when PLAN.md has `evaluate: true` in frontmatter; spawns runtime evaluator agent after Builder succeeds |
| New `/gsd:build-evaluate` slash command | A purpose-built command that orchestrates the full autonomous build-evaluate-iterate cycle for a single plan or phase. Not a modification to existing commands — a dedicated entry point for the full loop. Accepts `--max-rounds N` (default 3), `--plan <id>`, `--phase <N>` | MEDIUM | Wraps: seed test data, start dev server, run Builder, run runtime evaluator, route failures back to Builder, repeat up to N rounds, escalate to human after cap |
| Worktree isolation for build/evaluate parallelism | /superpowers pattern: evaluate in a separate git worktree so evaluation does not block the next build attempt. The evaluator reads the committed build artifact, not live working directory state. Prevents evaluator from seeing half-committed changes | HIGH | Uses existing `.claude/worktrees/` infrastructure from /superpowers; evaluator receives worktree path rather than main working directory |
| /code-review integration as quality gate | `/code-review` skill is already available but not wired into the autonomous pipeline. Injecting it as a gate before evaluation reduces the evaluator's workload (don't evaluate code that won't survive review) and aligns with the existing Blueprint pipeline's VERIFY stage | LOW | After Builder succeeds and before runtime evaluation: spawn code-review skill; if BLOCK verdict, route back to Builder; if PASS/FLAG, proceed to runtime evaluation |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full Playwright test suite execution as evaluation | "Run all E2E tests to verify nothing is broken" sounds comprehensive | The full E2E suite (auth, billing, schedule, etc.) takes minutes and most tests are irrelevant to the specific feature being evaluated. This turns every build-evaluate round into a multi-minute blocking operation. The evaluator becomes the bottleneck | Write scenario-scoped test scripts per feature, not a full regression suite. The existing E2E suite runs in CI; the evaluator writes and runs targeted scenarios scoped to the feature just built |
| Persistent dev server across all rounds | "Start once and reuse" seems efficient | A dev server with stale seeded data from a previous round produces false positives in subsequent rounds. The evaluator verifies against the state it expects, not the state that was left by the last run | Restart the dev server and re-seed before each evaluation round. Cost: ~10s startup time per round. Benefit: deterministic evaluation state |
| Visual pixel-diff regression testing | Screenshot comparison to baseline seems rigorous | Pixel-diff produces false positives on every font rendering difference, anti-aliasing variation, or minor layout change. It requires maintaining baseline screenshots that go stale. The value is low relative to the maintenance overhead | Grade screenshots using LLM rubric against design-system specs. The evaluator judges "does this button use the correct token?" not "does this pixel match?" |
| Separate evaluation database | "Isolate evaluation from dev data" sounds clean | KeeperHub's seed scripts already create isolated test users and workflows. A separate DB requires maintaining two schema-sync paths and means the evaluator cannot reuse the dev seed utilities | Use the dev database with seeded test data. The `seed-user.ts` script creates `dev@keeperhub.local` which is already isolated from real user data |
| Agent self-evaluation without an independent evaluator | "The Builder can grade its own output" saves spawning a second agent | The Anthropic harness article is explicit: agents "confidently praise" their own output even when quality is mediocre. The Verifier agent already demonstrates this pattern (read-only, independent, gates PR creation). The evaluator must be a separate agent | Runtime Evaluator agent is strictly read-only and independent from Builder, same separation as Verifier. Evaluator NEVER modifies files. |
| LLM-graded scoring without deterministic checks first | "Just ask the model if it looks right" is faster to implement | LLM graders are non-deterministic and require calibration. Using LLM grading for things that can be checked deterministically (HTTP status codes, token compliance, console errors) wastes tokens and introduces score variance | Deterministic checks first: HTTP assertions, console error counts, token violations via `scripts/token-audit.js`. LLM grading only for dimensions that require judgment: visual quality, UX flow completeness |

---

## Feature Dependencies

```
Dev server lifecycle management
    └──required by──> Playwright UI evaluation
    └──required by──> HTTP assertion API evaluation

Test data seeding
    └──required by──> Playwright UI evaluation (needs seeded user to log in)
    └──required by──> HTTP assertion API evaluation (needs seeded workflows/API keys)
    └──must run after──> Dev server starts (DB must be reachable)

Sprint contract negotiation
    └──runs before──> Builder (IMPLEMENT stage)
    └──produces──> testable criteria for evaluator

Per-criterion PASS/FAIL scoring
    └──required by──> Structured evaluation report
    └──drives──> Targeted fix feedback to Builder

Structured evaluation report (EVAL_REPORT)
    └──consumed by──> Orchestrator routing (same as Verification Report)
    └──gates──> Next round or escalation

Round cap with escalation
    └──depends on──> Structured evaluation report (needs round count)
    └──integrates with──> SAFE-02 (existing 2-round implement-verify limit)

/gsd:build-evaluate command
    └──requires──> Dev server lifecycle management
    └──requires──> Test data seeding
    └──requires──> Playwright UI evaluation
    └──requires──> HTTP assertion API evaluation
    └──requires──> Per-criterion PASS/FAIL scoring
    └──requires──> Structured evaluation report
    └──requires──> Round cap with escalation

Evaluate-after-build step in execute-phase
    └──requires──> /gsd:build-evaluate (or its component agents)
    └──integrates with──> existing execute-phase IMPLEMENT->VERIFY flow

Worktree isolation
    └──enhances──> /gsd:build-evaluate (parallelism, clean state)
    └──depends on──> existing .claude/worktrees/ infrastructure from /superpowers

/code-review integration
    └──runs before──> Playwright UI evaluation (pre-screens code quality)
    └──depends on──> existing /code-review skill

UI evaluation against design-system specs
    └──requires──> Dev server lifecycle management
    └──requires──> playwright-cli skill
    └──requires──> specs/design-system/ token reference
    └──enhances──> Calibrated per-dimension scoring rubric
```

### Dependency Notes

- **Dev server lifecycle is the root dependency.** Every runtime check requires a running server. Dev server management must be Phase 1 of the milestone.
- **Sprint contract negotiation is high-leverage but optional for MVP.** The evaluator can grade against existing Task Brief criteria without pre-negotiation. Add sprint contract negotiation in v1.x after the basic loop works.
- **Worktree isolation is an enhancement, not a blocker.** The basic build-evaluate loop works without it. Add when parallelism is needed (multiple features building simultaneously).
- **/code-review integration is additive.** The existing `/code-review` skill gates can be wired in without changes to the skill itself. Low integration cost, high signal quality.
- **UI evaluation against design-system specs requires calibration.** The LLM grader needs few-shot examples aligned with `specs/design-system/` semantics before it produces reliable verdicts. Do not ship without calibration examples.

---

## MVP Definition

### Launch With (v1 — Working Loop)

Minimum viable runtime evaluation loop. Validates that features built by the agent pipeline actually work against a running server.

- [ ] Dev server lifecycle management — start, health-check, teardown; port conflict handling
- [ ] Test data seeding invocation — seed-user, seed-test-workflow, seed-test-wallet in order
- [ ] Per-criterion PASS/FAIL scoring — each Task Brief success criterion independently graded
- [ ] HTTP assertion-based API evaluation — status codes, response shapes against running server
- [ ] Playwright UI evaluation — targeted scenario scripts using existing helpers (signIn, createWorkflow, etc.)
- [ ] Structured EVAL_REPORT with APPROVED: true/false — same boolean gate as Verifier report
- [ ] Round cap (default 3) with human escalation after cap
- [ ] Runtime Evaluator agent definition (`.claude/agents/evaluator.md`) — read-only, strictly independent from Builder
- [ ] `/gsd:build-evaluate` slash command — entry point for the full loop

### Add After Validation (v1.x — Calibrated Loop)

Add once the basic loop runs end-to-end and the scoring is shown to catch real issues.

- [ ] Sprint contract negotiation — evaluator reviews PLAN.md criteria before Builder runs and makes them testable; trigger: when false negatives are observed (evaluator PASS but feature broken in human review)
- [ ] Calibrated per-dimension scoring rubric — functionality / correctness / UI token compliance / API contract; trigger: when single-dimension failures are being masked by aggregate PASS
- [ ] UI evaluation against design-system specs — screenshot + LLM rubric against `specs/design-system/`; trigger: when UI regressions reach production that token-audit.js did not catch
- [ ] /code-review integration as pre-evaluation gate — trigger: when evaluator is spending rounds on code quality issues that /code-review would have caught first
- [ ] Evaluate-after-build step wired into execute-phase — trigger: once /gsd:build-evaluate is stable and the round overhead is acceptable

### Future Consideration (v2+)

Defer until v1 and v1.x are validated.

- [ ] Worktree isolation for build/evaluate parallelism — defer until multiple features are being built simultaneously and sequential evaluation is a bottleneck
- [ ] Evaluator uses playwright-cli for live interaction (beyond probe) — defer until static playwright assertions are shown to miss interaction-dependent bugs
- [ ] Pass@k tracking across multiple evaluation trials — defer until there is enough run history to make statistical analysis meaningful
- [ ] Evaluation transcript recording for debugging — defer until the loop is stable enough that transcript review is the primary debugging path

---

## Feature Prioritization Matrix

| Feature | Agent Value | Implementation Cost | Priority |
|---------|-------------|---------------------|----------|
| Dev server lifecycle management | HIGH | MEDIUM | P1 |
| Test data seeding invocation | HIGH | LOW | P1 |
| Per-criterion PASS/FAIL scoring | HIGH | LOW | P1 |
| HTTP assertion API evaluation | HIGH | MEDIUM | P1 |
| Playwright UI evaluation | HIGH | MEDIUM | P1 |
| Structured EVAL_REPORT | HIGH | LOW | P1 |
| Round cap with escalation | HIGH | LOW | P1 |
| Runtime Evaluator agent definition | HIGH | LOW | P1 |
| /gsd:build-evaluate command | HIGH | MEDIUM | P1 |
| Sprint contract negotiation | HIGH | HIGH | P2 |
| Calibrated per-dimension rubric | MEDIUM | MEDIUM | P2 |
| UI evaluation against design-system specs | MEDIUM | HIGH | P2 |
| /code-review pre-evaluation gate | MEDIUM | LOW | P2 |
| Evaluate-after-build in execute-phase | MEDIUM | MEDIUM | P2 |
| Worktree isolation | LOW | HIGH | P3 |
| playwright-cli live interaction (full) | LOW | HIGH | P3 |
| Pass@k tracking | LOW | HIGH | P3 |
| Evaluation transcript recording | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch — the loop does not work without these
- P2: Should have — improves accuracy and signal quality
- P3: Nice to have — future scalability

---

## Integration Points with Existing Infrastructure

This milestone adds new agents and commands on top of the existing pipeline. No existing agents are modified.

| Existing Component | How v1.6 Integrates |
|-------------------|---------------------|
| Blueprint pipeline (DECOMPOSE->RESEARCH->IMPLEMENT->VERIFY->PR) | Runtime evaluation runs AFTER VERIFY, as a new optional EVALUATE stage before PR; does not replace VERIFY |
| Verifier agent (`verifier.md`) | Static check (lint, type-check, build) remains as-is; Runtime Evaluator is a separate agent for behavioral testing |
| SAFE-02 (2-round iteration limit) | Runtime evaluation rounds are tracked separately from implement-verify rounds; combined limit prevents excessive total iteration |
| /gsd:execute-phase | Gains optional `--evaluate` flag; when active, spawns Runtime Evaluator after Builder succeeds |
| /gsd:autonomous --auto | Automatic evaluation happens when phases have `evaluate: true` in PLAN.md frontmatter; no flag needed |
| Playwright E2E tests (tests/e2e/playwright/) | Runtime evaluator writes scenario-scoped scripts to a separate directory (`tests/e2e/playwright/eval-scenarios/`); does not modify existing test files |
| scripts/seed/* | Evaluator invokes existing seed scripts unchanged; no new seed scripts needed for MVP |
| scripts/token-audit.js | Evaluator runs token-audit.js as a deterministic pre-check before LLM UI grading |
| /code-review skill | Wired as pre-evaluation gate (P2); evaluator spawns /code-review and waits for PASS before browser testing |

---

## Scoring Pattern: What Constitutes PASS vs FAIL

This is the most important design decision for the evaluator. Based on Anthropic harness article patterns and Demystifying Evals analysis.

### Deterministic Checks (run first, fast, cheap)

| Check | Tool | PASS Condition |
|-------|------|----------------|
| HTTP status codes | `curl` against localhost:3000 | Expected endpoints return expected status (200, 201, 400, etc.) |
| Response shape | HTTP assertion | Required fields present in JSON response |
| No JavaScript console errors | playwright-cli `console` command | Zero error-level console messages on target pages |
| Design token compliance | `node scripts/token-audit.js --quiet` | Zero errors (hardcoded colors/values) |
| DB side effects | Direct DB query via existing seed utilities | Expected records created/updated after POST/PUT |

### LLM-Graded Checks (run after deterministic, for dimensions requiring judgment)

| Dimension | Grader Input | PASS Condition |
|-----------|--------------|----------------|
| UI renders as specified | Screenshot + success criterion text | LLM grades criterion as met based on screenshot evidence |
| User flow completable | Playwright interaction trace + criterion | LLM confirms flow completes without dead ends |
| API contract matches spec | Response body + criterion text | LLM confirms response semantics match criterion |

### Aggregate Rule

`APPROVED: true` requires ALL deterministic checks PASS AND ALL LLM-graded checks PASS. A single FAIL in any dimension produces `APPROVED: false` with the specific failing criterion and evidence cited.

---

## Sources

- [Anthropic: Harness design for long-running agentic applications](https://www.anthropic.com/engineering/harness-design-long-running-apps) — generator-evaluator separation, sprint contracts, calibrated scoring, 3-round QA cycles, Playwright MCP for live app interaction
- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — code-based vs model-based vs human graders, pass@k metric, isolated environment requirement, transcript recording
- [Martin Fowler: How far can we push AI autonomy in code generation?](https://martinfowler.com/articles/pushing-ai-autonomy.html) — runtime verification as the distinguishing factor between static and behavioral correctness
- [Ralph Wiggum Loop pattern (aihero.dev)](https://www.aihero.dev/events/turn-ai-agents-into-autonomous-software-engineers-with-ralph) — autonomous iteration with completion criteria, re-inject context on failure
- [Agent Evaluation Framework 2026 (galileo.ai)](https://galileo.ai/blog/agent-evaluation-framework-metrics-rubrics-benchmarks) — rubric-based evaluation, per-dimension scoring
- KeeperHub codebase: existing Verifier agent (`verifier.md`), Blueprint pipeline (`blueprint-pipeline.md`), seed scripts (`scripts/seed/`), E2E test infrastructure (`tests/e2e/playwright/CLAUDE.md`), design system audit (`scripts/token-audit.js`), playwright-cli skill (`skills/playwright-cli/SKILL.md`)

---
*Feature research for: KeeperHub v1.6 — Autonomous Build-Evaluate Loop*
*Researched: 2026-03-29*
