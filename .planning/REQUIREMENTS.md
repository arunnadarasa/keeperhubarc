# Requirements: v1.6 Autonomous Build-Evaluate Loop

## Evaluation Infrastructure (INFRA)

- [ ] **INFRA-01**: Dev server can be started, health-checked, and torn down programmatically without orphaned processes
- [x] **INFRA-02**: Portless (vercel-labs/portless) manages dev server URLs with named `.localhost` subdomains, eliminating port conflicts
- [x] **INFRA-03**: Worktree-based evaluation gets automatic unique URLs via portless git worktree detection
- [x] **INFRA-04**: Existing seed scripts (user, workflow, wallet, API keys) run before each evaluation round producing deterministic test state

## Runtime Evaluation (EVAL)

- [ ] **EVAL-01**: HTTP assertions verify API endpoints against running server (status codes, response shapes, DB side effects)
- [ ] **EVAL-02**: Playwright UI evaluation runs targeted scenario scripts using existing auth/workflow helpers
- [ ] **EVAL-03**: UI evaluation grades screenshots against specs/design-system/ tokens via LLM rubric
- [ ] **EVAL-04**: Each success criterion from PLAN.md is independently scored PASS/FAIL with evidence
- [ ] **EVAL-05**: Deterministic checks (HTTP status, console errors, token-audit.js) run before LLM grading

## Loop Orchestration (LOOP)

- [x] **LOOP-01**: gsd-evaluator agent exists as a read-only, independent agent separate from Builder and Verifier
- [x] **LOOP-02**: Structured EVAL.md report with per-criterion scores, evidence, and APPROVED boolean gate
- [x] **LOOP-03**: Build-QA loop capped at configurable max rounds (default 3), with convergence check (same failures in round N and N-1 halt immediately)
- [x] **LOOP-04**: SAFE-02 coordination: evaluation rounds tracked separately from implement-verify rounds
- [x] **LOOP-05**: Sprint contract negotiation: evaluator reviews PLAN.md criteria pre-build and proposes testable scenarios
- [ ] **LOOP-06**: execute-phase gains automatic evaluate-after-build step when PLAN.md has `evaluate: true`

## Commands and Integration (CMD)

- [ ] **CMD-01**: `/gsd:build-evaluate` slash command orchestrates full autonomous build-evaluate-iterate cycle with `--max-rounds N`
- [ ] **CMD-02**: /code-review runs as pre-evaluation gate before runtime testing
- [ ] **CMD-03**: Worktree isolation for build/evaluate with portless providing unique URLs per worktree
- [ ] **CMD-04**: Each new feature goes through /gsd:new-milestone flow as the standard development process

## Process (PROC)

- [ ] **PROC-01**: Full loop runs end-to-end with /gsd:autonomous --auto (no user input except auth gates)

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| INFRA-01 | Phase 26 | Pending |
| INFRA-02 | Phase 26 | Complete |
| INFRA-03 | Phase 26 | Complete |
| INFRA-04 | Phase 26 | Complete |
| EVAL-01 | Phase 26 | Pending |
| EVAL-02 | Phase 26 | Pending |
| EVAL-03 | Phase 27 | Pending |
| EVAL-04 | Phase 27 | Pending |
| EVAL-05 | Phase 26 | Pending |
| LOOP-01 | Phase 25 | Complete |
| LOOP-02 | Phase 25 | Complete |
| LOOP-03 | Phase 25 | Complete |
| LOOP-04 | Phase 25 | Complete |
| LOOP-05 | Phase 25 | Complete |
| LOOP-06 | Phase 27 | Pending |
| CMD-01 | Phase 29 | Pending |
| CMD-02 | Phase 29 | Pending |
| CMD-03 | Phase 28 | Pending |
| CMD-04 | Phase 29 | Pending |
| PROC-01 | Phase 28 | Pending |

## Future Requirements (deferred)

- Pass@k tracking across multiple evaluation trials
- Evaluation transcript recording for debugging
- Full playwright-cli live interaction beyond probe

## Out of Scope

- Full Playwright suite execution per evaluation round -- targeted scenarios only, full suite runs in CI
- Persistent dev server across rounds -- stale seed data produces false positives
- Pixel-diff visual regression testing -- LLM rubric against design tokens instead
- Agent self-evaluation -- evaluator must be strictly independent from builder
- Separate evaluation database -- existing seed scripts with test users provide sufficient isolation
