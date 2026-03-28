# EVAL.md Format Specification

## Purpose

EVAL.md is the evaluation report written by gsd-evaluator after each evaluation round. It is read by the execute-phase orchestrator for routing decisions (approved: true advances to PR creation; approved: false triggers another fix round or escalation), and by gsd-planner --gaps for fix plan generation (the gaps array drives what the executor builds in the next round).

---

## File Naming Convention

The evaluator writes one EVAL file per round. Previous rounds must NOT be overwritten -- full round history is required for convergence detection.

| Round | File name | Example |
|-------|-----------|---------|
| 1 | `{padded-phase}-EVAL.md` | `26-EVAL.md` |
| 2 | `{padded-phase}-EVAL-ROUND-2.md` | `26-EVAL-ROUND-2.md` |
| 3 | `{padded-phase}-EVAL-ROUND-3.md` | `26-EVAL-ROUND-3.md` |
| N | `{padded-phase}-EVAL-ROUND-{N}.md` | `26-EVAL-ROUND-4.md` |

The padded-phase prefix matches the two-digit phase number (e.g., phase 26 uses prefix `26`, not `026`).

**Orchestrator detection command (always finds the most recent evaluation):**

```bash
LATEST_EVAL=$(ls -t "${PHASE_DIR}"/*-EVAL*.md 2>/dev/null | head -1)
```

---

## YAML Frontmatter Schema

All fields are required unless marked (OPTIONAL).

```yaml
---
phase: "{XX}-{phase-name}"        # example: "26-dev-server-lifecycle"
evaluated: "YYYY-MM-DDTHH:MM:SSZ" # ISO 8601 UTC timestamp
status: passed | failed | convergence_halt
score: "{N}/{M}"                   # example: "6/7" -- autonomous criteria only (manual_review excluded)
round: 1                           # integer -- current round number (1, 2, 3...)
max_rounds: 3                      # integer -- from EVAL-CONFIG.yml, default 3
approved: true | false             # boolean -- the gate field read by orchestrator
server_port: 3099                  # integer -- port the dev server ran on
seed_ran: true | false             # boolean -- whether seed scripts executed successfully
gaps:                              # empty array [] if approved is true
  - criterion: "{criterion id and description}"
    type: ui_behavior | api_assertion | design_token | unit_test | manual_review
    status: failed
    reason: "{why it failed -- specific, not generic}"
    evidence: "{verbatim command output, HTTP response, or assertion detail}"
    fix_hints:
      - "{actionable hint for gsd-executor to implement}"
      - "{second hint if needed}"
delta:                             # (OPTIONAL -- only present in round 2+)
  fixed:
    - criterion: "{criterion id}"
      evidence: "{what changed that fixed it}"
  still_failing:
    - criterion: "{criterion id}"
      evidence: "{current failing output}"
  new_failures: []                 # must be empty if criterion locking works correctly
---
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `phase` | string | Phase identifier in format `{XX}-{phase-name}` |
| `evaluated` | string | ISO 8601 UTC timestamp of when evaluation ran |
| `status` | enum | Result of this evaluation round (see Status Values) |
| `score` | string | `"{passing_autonomous}/{total_autonomous}"` -- excludes manual_review |
| `round` | integer | Current round number, starting at 1 |
| `max_rounds` | integer | Configured maximum rounds from EVAL-CONFIG.yml |
| `approved` | boolean | True if and only if status is "passed" (see Approved Boolean Rules) |
| `server_port` | integer | Port on which the dev server was running during evaluation |
| `seed_ran` | boolean | Whether seed scripts completed successfully before evaluation |
| `gaps` | array | Failing criteria details; empty array if approved is true |
| `delta` | object | Round-over-round diff; present only in rounds 2+ |

---

## Status Values

| Status | Meaning | approved value |
|--------|---------|----------------|
| `passed` | All autonomous criteria at or above threshold from EVAL-CONFIG.yml | `true` |
| `failed` | One or more autonomous criteria failed; round not yet at max_rounds | `false` |
| `convergence_halt` | Failing criteria set in round N equals round N-1 exactly; escalate immediately without consuming another round | `false` |

**convergence_halt rule:** After any round N >= 2, if `set(current_failing_criteria) == set(previous_failing_criteria)`, the evaluator writes status `convergence_halt` and sets approved to false. The orchestrator escalates to human immediately. This fires BEFORE checking whether round N equals max_rounds.

---

## Score Calculation

Score counts ONLY autonomous criterion types: `ui_behavior`, `api_assertion`, `design_token`, `unit_test`.

Criteria with type `manual_review` are excluded from score and excluded from the approved gate.

**Formula:**

```
passing_autonomous = count of criteria with type in {ui_behavior, api_assertion, design_token, unit_test} that passed
total_autonomous   = count of criteria with type in {ui_behavior, api_assertion, design_token, unit_test}
score              = "{passing_autonomous}/{total_autonomous}"
approved = (passing_autonomous / total_autonomous) >= threshold  # where threshold is from EVAL-CONFIG.yml, default 0.85
```

**Edge case:** If total_autonomous is 0, score is "0/0" and approved is true (vacuously passes). Only applies when all criteria are manual_review. Use with caution -- document in EVAL-CONFIG.yml.

---

## Approved Boolean Rules

- `approved: true` if and only if `status: passed`
- `approved: false` for both `status: failed` and `status: convergence_halt`
- approved is a YAML boolean, not a string -- write `true` or `false`, not `"true"` or `"false"`

**Orchestrator reading pattern:**

```bash
EVAL_STATUS=$(grep "^approved:" "${LATEST_EVAL}" 2>/dev/null | cut -d: -f2 | tr -d ' ')
```

**Human readability:** The markdown body must also include a status line for human readers:

- When approved: `**Status: APPROVED**`
- When not approved: `**Status: REJECTED**`

---

## Markdown Body Structure

The body must contain these sections in the following order:

```markdown
# Evaluation Report: Phase {N} -- {Phase Name}

**Round:** {N} of {max_rounds}
**Score:** {passing}/{total} autonomous criteria passing
**Server:** http://localhost:{port}
**Seed:** {ran | skipped | failed}
**Status:** PASSED | FAILED -- {N} gaps blocking threshold | CONVERGENCE HALT -- same failures as round {N-1}

**Status: APPROVED** | **Status: REJECTED**

---

## Criteria Results

| # | Criterion ID | Description | Type | Status | Evidence |
|---|--------------|-------------|------|--------|----------|
| 1 | UI-01 | {description} | ui_behavior | PASS | Playwright: exit 0 |
| 2 | API-01 | {description} | api_assertion | FAIL | HTTP 400, expected 201 |
| 3 | MANUAL-01 | {description} | manual_review | PENDING | See Manual Review section |

## Gaps

### Gap 1: {Criterion ID} -- {Description}

**Type:** {type}
**Reason:** {specific reason it failed}
**Evidence:**
```
{verbatim command output, HTTP response body, or assertion detail}
```
**Fix hints:**
- {actionable hint for executor}
- {second hint if needed}

## Manual Review Needed

{Omit this section if no manual_review criteria exist}

| Criterion ID | Description | Review Guidance |
|--------------|-------------|-----------------|
| MANUAL-01 | {description} | {what reviewer should check} |

Manual review criteria never affect the approved gate. They surface here for human reviewers after the build is approved.

## Delta from Previous Round

{OMIT THIS SECTION ENTIRELY IN ROUND 1}

### Fixed since round {N-1}

- {Criterion ID}: {brief evidence of fix}

### Still failing

- {Criterion ID}: {brief evidence still failing}

### New failures

- {Must be empty if criterion locking is working. List any regression here.}

## Server Log (tail)

{ONLY include this section if one or more gaps involve server-side errors}
{Last 20 lines of dev server stderr}
```

**Section presence rules:**

| Section | Round 1 | Round 2+ | Notes |
|---------|---------|---------|-------|
| Criteria Results | Always | Always | |
| Gaps | If failed/convergence_halt | If failed/convergence_halt | Omit (or empty) if passed |
| Manual Review Needed | If any manual_review criteria | If any manual_review criteria | |
| Delta from Previous Round | OMIT | Always | Never present in round 1 |
| Server Log | Only if server error in gaps | Only if server error in gaps | |

---

## Criterion Locking

Criteria that passed in round N must NOT be re-checked in round N+1. Only previously-failing criteria are evaluated in subsequent rounds. This:

1. Prevents regressions from being masked by passing criteria
2. Ensures "New failures" in delta is always empty under correct operation
3. Makes convergence detection reliable (comparing failure sets, not full result sets)

If a previously-passing criterion would regress, it MUST appear in the "New failures" delta section. The executor should investigate root cause before proceeding.
