---
phase: 25-loop-architecture-and-evaluator-agent
plan: "01"
subsystem: gsd-agent-pipeline
tags:
  - evaluator
  - eval-format
  - data-contracts
  - specification
dependency_graph:
  requires: []
  provides:
    - 25-EVAL-FORMAT-SPEC.md (EVAL.md schema for downstream phases 26/27/28)
    - 25-EVAL-CONFIG-SPEC.md (EVAL-CONFIG.yml schema with all five criterion types)
    - 25-SPRINT-CONTRACT-SPEC.md (SPRINT-CONTRACT.md format for pre-build review)
  affects:
    - Phase 26 (implements EVAL-CONFIG.yml parsing and EVAL.md writing against these specs)
    - Phase 27 (implements scoring and gap extraction against EVAL.md schema)
    - Phase 28 (reads EVAL.md approved field for execute-phase routing)
tech_stack:
  added: []
  patterns:
    - YAML frontmatter + markdown body pattern (consistent with VERIFICATION.md)
    - Five criterion type enum (ui_behavior, api_assertion, design_token, unit_test, manual_review)
    - Round-preserving file naming (EVAL.md, EVAL-ROUND-2.md, EVAL-ROUND-3.md)
key_files:
  created:
    - .planning/phases/25-loop-architecture-and-evaluator-agent/25-EVAL-FORMAT-SPEC.md
    - .planning/phases/25-loop-architecture-and-evaluator-agent/25-EVAL-CONFIG-SPEC.md
    - .planning/phases/25-loop-architecture-and-evaluator-agent/25-SPRINT-CONTRACT-SPEC.md
  modified: []
decisions:
  - "approved field is YAML boolean in frontmatter AND human-readable text in body (both, not either)"
  - "convergence_halt fires before round cap check -- same failure set in consecutive rounds triggers immediate escalation"
  - "manual_review criteria are never autonomous-gateable; trigger word list is explicit"
  - "sprint contract is advisory/non-blocking; pipeline never halts on contract failure"
  - "criterion locking: passed criteria are not re-checked in subsequent rounds"
metrics:
  duration: "4 minutes"
  completed: "2026-03-29"
  tasks_completed: 2
  files_created: 3
  files_modified: 0
---

# Phase 25 Plan 01: Format Specifications Summary

Three data contract specification files that define the EVAL.md, EVAL-CONFIG.yml, and SPRINT-CONTRACT.md formats for all downstream evaluator phases (26, 27, 28) to implement against.

## What Was Built

### 25-EVAL-FORMAT-SPEC.md

Complete specification for the EVAL.md evaluation report written by gsd-evaluator after each round:

- YAML frontmatter schema with all required fields: `phase`, `evaluated`, `status`, `score`, `round`, `max_rounds`, `approved` (boolean gate), `server_port`, `seed_ran`, `gaps` array, and optional `delta` object
- Three status values: `passed` (approved: true), `failed` (approved: false), `convergence_halt` (approved: false, fires before round cap when failure set is identical to previous round)
- Score calculation formula: counts only autonomous criterion types; excludes manual_review
- Approved boolean rules: YAML boolean in frontmatter + text status line in body for human readability
- Markdown body structure: Criteria Results table, Gaps section, Manual Review Needed table, Delta from Previous Round (rounds 2+ only), Server Log (tail, only for server errors)
- Criterion locking rule: passed criteria in round N are not re-evaluated in round N+1
- File naming convention: round 1 = `{phase}-EVAL.md`, rounds 2+ = `{phase}-EVAL-ROUND-{N}.md`
- Orchestrator detection command: `ls -t "${PHASE_DIR}"/*-EVAL*.md 2>/dev/null | head -1`

### 25-EVAL-CONFIG-SPEC.md

Complete specification for the EVAL-CONFIG.yml configuration file written by gsd-planner:

- Top-level fields: `threshold` (float, default 0.85), `max_rounds` (integer, default 3, feeds SAFE-02 fifth counter), `server_port` (integer, use non-standard port to avoid collision), `seed_scripts` (list, base seed always first), `criteria` (list)
- All five criterion type schemas with complete field lists: `ui_behavior` (Playwright exit code), `api_assertion` (HTTP status + optional body), `design_token` (token-audit.js exit code), `unit_test` (vitest exit code), `manual_review` (never autonomous)
- Criterion Classification Rule verbatim: autonomous-gateable only if determinable by command exit code or observable HTTP state assertion; trigger words list for mandatory manual_review
- Completeness rules: unique ID format per type prefix, required top-level fields, base seed requirement, vacuous pass documentation
- Cross-reference documenting how max_rounds and threshold feed into EVAL.md
- Minimal working example with one api_assertion and one manual_review criterion
- Orchestrator backward compatibility: phases without EVAL-CONFIG.yml skip evaluation entirely

### 25-SPRINT-CONTRACT-SPEC.md

Complete specification for the SPRINT-CONTRACT.md pre-build criteria testability review:

- Purpose: written by gsd-evaluator before gsd-executor runs; reviews PLAN.md success_criteria and proposes EVAL-CONFIG.yml entries
- When to write: fires once per plan in execute-phase setup; skipped if EVAL-CONFIG.yml already has explicit criteria
- Advisory/non-blocking rule: pipeline never halts; log warning and skip if PLAN.md lacks success_criteria
- File naming: `{padded-phase}-{plan}-SPRINT-CONTRACT.md` (e.g., `26-01-SPRINT-CONTRACT.md`)
- YAML frontmatter schema: `phase`, `reviewed`, `plan_file`, `criteria_reviewed`, `testable_autonomous`, `needs_human`, `proposed_criteria_count`
- Markdown body: summary block, Criteria Testability Review table, Proposed EVAL-CONFIG.yml Entries (ready-to-paste YAML), Evaluator Notes
- Testability Decision Rules: four conditions for autonomous testable (Yes); four conditions requiring manual_review
- Integration: auto-merged in auto mode; human-reviewed in interactive mode; file retained for audit

## Decisions Made

1. **approved field placement:** YAML boolean frontmatter (`approved: true|false`) for programmatic orchestrator reading, plus `**Status: APPROVED**`/`**Status: REJECTED**` text in markdown body for human readability. Both, not either.

2. **convergence_halt fires before round cap:** When the failing criterion set in round N equals round N-1 exactly, `convergence_halt` triggers immediately. This prevents wasting a round when progress is mathematically impossible.

3. **manual_review trigger word list is explicit:** "appropriate, reasonable, professional, intuitive, clear (in UI/UX context), looks correct, feels right, user-friendly" -- explicit list prevents subjective criteria from leaking into the autonomous gate.

4. **sprint contract is advisory, not blocking:** If the pipeline treated the contract as a hard gate, a missing `success_criteria` section in PLAN.md would block all builds. Advisory design keeps backward compatibility.

5. **criterion locking:** Criteria that passed in round N are not re-checked in round N+1. This makes convergence detection reliable (comparing only failure sets, not full result sets) and prevents regression masking.

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None. These are specification documents with no data sources or UI components.

---

## Self-Check

Files exist:
- FOUND: .planning/phases/25-loop-architecture-and-evaluator-agent/25-EVAL-FORMAT-SPEC.md
- FOUND: .planning/phases/25-loop-architecture-and-evaluator-agent/25-EVAL-CONFIG-SPEC.md
- FOUND: .planning/phases/25-loop-architecture-and-evaluator-agent/25-SPRINT-CONTRACT-SPEC.md

Commits exist:
- FOUND: e5a81eb9 (Task 1: EVAL-FORMAT-SPEC and EVAL-CONFIG-SPEC)
- FOUND: c4736fab (Task 2: SPRINT-CONTRACT-SPEC)

## Self-Check: PASSED
