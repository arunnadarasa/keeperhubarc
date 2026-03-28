---
phase: 29-build-evaluate-command-and-calibration
plan: 01
subsystem: infra
tags: [gsd, evaluation, build-evaluate, command, code-review, portless]

requires:
  - phase: 28-execute-phase-integration
    provides: runtime_evaluation_gate orchestration logic and gsd-evaluator/executor spawn patterns

provides:
  - "/gsd:build-evaluate slash command at ~/.claude/get-shit-done/commands/gsd/build-evaluate.md"
  - "Standalone build-evaluate-iterate cycle entry point (CMD-01)"
  - "/code-review pre-evaluation gate with PR-existence guard (CMD-02)"

affects:
  - 29-build-evaluate-command-and-calibration
  - any phase using /gsd:build-evaluate for targeted runtime evaluation

tech-stack:
  added: []
  patterns:
    - "GSD command file: YAML frontmatter with description: key only, then numbered ## Step N headings"
    - "code-review gate: check gh pr view before Skill(skill=code-review); skip with log if no PR"
    - "Portless detection block: PORTLESS_AVAILABLE=0 init, then conditional set if portless lists keeperhub"
    - "EFFECTIVE_MAX_ROUNDS: --max-rounds flag caps outer loop, does not modify EVAL-CONFIG.yml"

key-files:
  created:
    - "~/.claude/get-shit-done/commands/gsd/build-evaluate.md"
  modified: []

key-decisions:
  - "build-evaluate directly spawns gsd-executor and gsd-evaluator via Task(); does not invoke execute-phase as sub-skill to avoid triggering full lifecycle (roadmap updates, verifier, phase-complete)"
  - "code-review gate is best-effort: if user chooses to continue with blocking issues, evaluation proceeds"
  - "--max-rounds N caps the outer evaluation loop only; EVAL-CONFIG.yml max_rounds field is not modified"
  - "Step 6 (success) explicitly states no ROADMAP.md update and no phase-complete marking"

patterns-established:
  - "GSD command files in ~/.claude/get-shit-done/commands/gsd/ use only description: in frontmatter (no allowed-tools)"
  - "PR-existence check pattern: PR_NUMBER=$(gh pr view --json number --jq .number 2>/dev/null)"

requirements-completed: [CMD-01, CMD-02]

duration: 3min
completed: 2026-03-29
---

# Phase 29 Plan 01: Build-Evaluate Command Summary

**/gsd:build-evaluate slash command with 7-step orchestration: PR-existence guard, /code-review gate, portless detection, gsd-evaluator spawn, gap-fix loop, and SAFE-02 escalation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-28T22:15:01Z
- **Completed:** 2026-03-28T22:18:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created `~/.claude/get-shit-done/commands/gsd/build-evaluate.md` following the workstreams.md GSD command pattern exactly
- Implemented CMD-01: full build-evaluate-iterate cycle as a standalone entry point with --phase N and --max-rounds N flags
- Implemented CMD-02: /code-review gate with gh pr view existence check before invoking code-review skill; skips gracefully if no PR

## Task Commits

Each task was committed atomically:

1. **Task 1: Create /gsd:build-evaluate command file** - (file outside git repo; committed with plan metadata)

**Plan metadata:** (docs commit hash below)

## Files Created/Modified

- `~/.claude/get-shit-done/commands/gsd/build-evaluate.md` - 7-step GSD slash command orchestrating full autonomous build-evaluate-iterate cycle for a single phase

## Decisions Made

- build-evaluate directly spawns gsd-executor and gsd-evaluator via Task() calls; does not invoke execute-phase as a sub-skill to avoid triggering the full phase lifecycle (roadmap updates, verifier, phase completion)
- /code-review gate is best-effort: if user encounters blocking issues and chooses to continue, evaluation proceeds regardless
- --max-rounds N caps the outer loop in build-evaluate only; EVAL-CONFIG.yml max_rounds field is never modified
- Portless detection block placed in Step 4 (same position as in execute-phase.md runtime_evaluation_gate)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- /gsd:build-evaluate command is ready for use; invoke with /gsd:build-evaluate --phase N
- Phase 29-02 (calibration fixtures) and 29-03 (CMD-04 plan-phase documentation) can proceed independently
- The command depends on gsd-evaluator and gsd-executor agents built in phases 25-28, which are already complete

---
*Phase: 29-build-evaluate-command-and-calibration*
*Completed: 2026-03-29*
