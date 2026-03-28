# Roadmap: KeeperHub

## Milestones

- v1.0 Service Extraction - Phases 1-4 (shipped 2026-02-12)
- v1.1 OG Image Generation - Phase 5 (shipped 2026-02-12)
- v1.2 Protocol Registry - Phases 6-9 (shipped 2026-02-20)
- v1.3 Direct Execution API - Phases 10-12 (shipped 2026-02-20)
- v1.4 Agent Team - Phases 13-18 (shipped 2026-03-01)
- v1.5 KeeperHub CLI - Phases 19-24.1 (shipped 2026-03-14)
- v1.6 Autonomous Build-Evaluate Loop - Phases 25-29 (in progress)

## Phases

<details>
<summary>v1.0 through v1.5 - SHIPPED</summary>

Phases 1-24.1 completed. See MILESTONES.md for details.

</details>

### v1.6 Autonomous Build-Evaluate Loop (In Progress)

**Milestone Goal:** Wire runtime evaluation into the KeeperHub development pipeline so features can be built, tested against a live app, and iterated fully autonomously.

- [x] **Phase 25: Loop Architecture and Evaluator Agent** - Define the evaluator agent, file formats, and loop termination contracts before any code runs (completed 2026-03-28)
- [x] **Phase 26: Dev Server Lifecycle and Evaluation Harness** - Reliable server startup, seed isolation, and evaluation script infrastructure (completed 2026-03-28)
- [x] **Phase 27: Scoring, Output, and Gap Closure** - Per-criterion scoring, EVAL.md report, and gap-to-fix-plan pipeline (completed 2026-03-28)
- [ ] **Phase 28: execute-phase Integration** - Conditional evaluate-after-build gate wired into existing execute-phase and autonomous workflows
- [ ] **Phase 29: Build-Evaluate Command and Calibration** - Standalone /gsd:build-evaluate command with calibration fixtures and quality gates

## Phase Details

### Phase 25: Loop Architecture and Evaluator Agent
**Goal**: The architectural contracts governing the evaluator agent, file formats, and loop termination rules are defined and documented before any runtime code executes
**Depends on**: Nothing (first phase of this milestone)
**Requirements**: LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05
**Success Criteria** (what must be TRUE):
  1. gsd-evaluator agent definition exists at ~/.claude/agents/gsd-evaluator.md with tools, model, and read-only isolation rules documented
  2. EVAL.md format specification exists with YAML frontmatter schema (status, score, round, max_rounds, gaps array) and markdown body structure
  3. EVAL-CONFIG.yml format specification exists with all required fields (threshold, max_rounds, server_port, seed_scripts, criteria list)
  4. Round cap is wired to SAFE-02: build-evaluate rounds count against the same iteration limit as lint/type-check fix rounds
  5. Convergence check is defined: identical failure sets in consecutive rounds trigger immediate escalation rather than another fix cycle
**Plans**: 2 plans

Plans:
- [x] 25-01-PLAN.md -- EVAL.md format spec, EVAL-CONFIG.yml format spec, SPRINT-CONTRACT.md format spec
- [x] 25-02-PLAN.md -- gsd-evaluator agent definition with evaluation flow, SAFE-02 coordination, convergence check, criterion locking

### Phase 26: Dev Server Lifecycle and Evaluation Harness
**Goal**: A dev server can be started, health-checked, seeded with deterministic test data, and torn down cleanly without zombie processes or port conflicts, enabling reliable evaluation runs
**Depends on**: Phase 25
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, EVAL-01, EVAL-02, EVAL-05
**Success Criteria** (what must be TRUE):
  1. playwright.evaluate.config.ts starts and stops the dev server via webServer block with no orphaned processes between rounds
  2. Portless assigns unique named .localhost subdomains to worktree evaluation contexts without port conflicts
  3. Running the evaluation harness twice in sequence produces identical seed state (deterministic test data, no contamination)
  4. HTTP assertions verify API endpoint status codes and response shapes against the running server
  5. Playwright UI scenarios execute using existing auth/workflow helpers and token-audit.js runs as a deterministic gate
**Plans**: 3 plans

Plans:
- [x] 26-01-PLAN.md -- portless devDependency install and scripts/evaluate/seed-eval.ts per-round seed wrapper
- [x] 26-02-PLAN.md -- playwright.evaluate.config.ts with webServer lifecycle, JSON reporter, portless integration
- [x] 26-03-PLAN.md -- eval-harness.test.ts with @autonomous smoke tests and 26-EVAL-CONFIG.yml

### Phase 27: Scoring, Output, and Gap Closure
**Goal**: Each success criterion from PLAN.md is independently scored PASS/FAIL with evidence, written to a structured EVAL.md report, and failing criteria generate actionable fix plans
**Depends on**: Phase 26
**Requirements**: EVAL-03, EVAL-04, LOOP-02, LOOP-06
**Success Criteria** (what must be TRUE):
  1. scripts/evaluate/score.ts reads Playwright JSON reporter output and writes a Zod-validated eval-score.json with per-criterion PASS/FAIL verdicts
  2. scripts/evaluate/criteria-scorer.ts grades UI screenshots against specs/design-system/ tokens via LLM rubric, invoked only after all deterministic checks pass
  3. EVAL.md is written with YAML frontmatter (APPROVED boolean, score, round, gaps array) and per-criterion results table including evidence and fix hints
  4. execute-phase gains an evaluate-after-build step that fires automatically when PLAN.md has evaluate: true and EVAL-CONFIG.yml is present
**Plans**: 3 plans

Plans:
- [x] 27-01-PLAN.md -- score.ts (deterministic Playwright JSON scoring) and criteria-scorer.ts (AI SDK v5 LLM rubric)
- [x] 27-02-PLAN.md -- runtime_evaluation_gate step in execute-phase.md (LOOP-06)
- [x] 27-03-PLAN.md -- --eval-gaps flag in plan-phase.md for EVAL.md-driven gap closure planning (LOOP-02)

### Phase 28: execute-phase Integration
**Goal**: The evaluate-after-build gate is wired into execute-phase and the autonomous workflow so the full build-evaluate-fix loop runs without human intervention for phases that declare evaluation
**Depends on**: Phase 27
**Requirements**: CMD-03, PROC-01
**Success Criteria** (what must be TRUE):
  1. execute-phase skips evaluation entirely for phases without EVAL-CONFIG.yml (full backward compatibility with all existing phases)
  2. execute-phase detects EVAL-CONFIG.yml, spawns gsd-evaluator, reads EVAL.md status, and loops or escalates based on score and round count
  3. STATE.md is updated with round count and last failing criteria before any escalation, so the human reviewer has complete context
  4. /gsd:autonomous --auto runs a full build-evaluate-fix cycle for a phase with evaluate: true and exits without user input except at auth gates
**Plans**: 2 plans

Plans:
- [x] 28-01-PLAN.md -- portless detection + isolation="worktree" on evaluator/gap-fix spawns, state patch commands in runtime_evaluation_gate
- [ ] 28-02-PLAN.md -- eval status check and gap closure routing in autonomous.md step 3d

### Phase 29: Build-Evaluate Command and Calibration
**Goal**: A standalone /gsd:build-evaluate command provides a simpler entry point for the full cycle, /code-review gates code quality before runtime testing, and calibration fixtures lock in evaluator quality
**Depends on**: Phase 28
**Requirements**: CMD-01, CMD-02, CMD-04
**Success Criteria** (what must be TRUE):
  1. /gsd:build-evaluate --phase N --max-rounds N orchestrates seed, dev server, builder, evaluator, and gap closure for a single phase
  2. /code-review runs as a pre-evaluation gate: evaluation does not begin if code review finds blocking issues
  3. Each new feature uses /gsd:new-milestone as the standard development process with evaluation config authored at plan time
  4. 5 calibration fixtures with known correct pass/fail verdicts exist and can be used to verify evaluator behavior after prompt changes
**Plans**: 3 plans

Plans:
- [ ] 29-01-PLAN.md -- /gsd:build-evaluate command file with code-review gate, portless detection, evaluator/gap-fix spawns
- [ ] 29-02-PLAN.md -- EVAL-CONFIG.yml authoring note added to plan-phase.md quality_gate checklist
- [ ] 29-03-PLAN.md -- 5 calibration fixture pairs in .planning/calibration/fixtures/

## Progress

**Execution Order:**
Phases execute in numeric order: 25 -> 26 -> 27 -> 28 -> 29

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 25. Loop Architecture and Evaluator Agent | v1.6 | 2/2 | Complete   | 2026-03-28 |
| 26. Dev Server Lifecycle and Evaluation Harness | v1.6 | 3/3 | Complete   | 2026-03-28 |
| 27. Scoring, Output, and Gap Closure | v1.6 | 3/3 | Complete   | 2026-03-28 |
| 28. execute-phase Integration | v1.6 | 1/2 | In Progress|  |
| 29. Build-Evaluate Command and Calibration | v1.6 | 0/3 | Not started | - |
