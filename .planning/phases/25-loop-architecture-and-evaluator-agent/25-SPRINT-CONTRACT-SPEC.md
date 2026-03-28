# SPRINT-CONTRACT.md Format Specification

## Purpose

SPRINT-CONTRACT.md is written by gsd-evaluator during the pre-build sprint contract negotiation step (LOOP-05). Before gsd-executor runs, the evaluator reviews each success criterion in PLAN.md and assesses whether it can be tested autonomously. It proposes EVAL-CONFIG.yml criterion entries for the planner to merge, ensuring every planned criterion has a concrete, executable test before a single line of implementation code is written.

This prevents the scenario where the planner writes a criterion like "workflow creation works" and the evaluator later has no executable assertion to test against it.

---

## When to Write

Sprint contract review fires once per plan, during execute-phase setup, BEFORE gsd-executor is spawned. The sequence:

```
execute-phase starts
    |
    v
check for {padded-phase}-EVAL-CONFIG.yml with explicit criteria for this plan
    |
    if explicit criteria exist --> SKIP sprint contract (go directly to build)
    |
    if no EVAL-CONFIG.yml or no plan-specific criteria:
    |
    v
spawn gsd-evaluator in sprint-contract mode
    |
    reads PLAN.md success_criteria section
    assesses each criterion for autonomous testability
    writes {padded-phase}-{plan}-SPRINT-CONTRACT.md
    |
    v
execute-phase presents contract for review (or auto-merges in auto mode)
    |
    v
accepted entries merged into EVAL-CONFIG.yml
    |
    v
gsd-executor spawned (build phase begins)
```

---

## Advisory, Not Blocking

The sprint contract is advisory. The pipeline must never halt due to sprint contract issues.

- If PLAN.md has no `success_criteria` section: log a warning and skip sprint contract. Proceed to build.
- If EVAL-CONFIG.yml already exists with explicit criteria for the plan being executed: skip sprint contract entirely.
- If gsd-evaluator fails to write the sprint contract for any reason: log the error and proceed to build without it.

Never block the pipeline on sprint contract output. The contract file is a recommendation, not a prerequisite.

---

## File Naming Convention

| Property | Value |
|----------|-------|
| Name | `{padded-phase}-{plan-number}-SPRINT-CONTRACT.md` |
| Example | `26-01-SPRINT-CONTRACT.md` |
| Location | `.planning/phases/{phase-dir}/` |

The padded-phase matches the two-digit phase number. The plan-number matches the two-digit plan number (e.g., `01`, `02`).

---

## YAML Frontmatter Schema

All fields are required.

```yaml
---
phase: "{XX}-{phase-name}"              # example: "26-dev-server-lifecycle"
reviewed: "YYYY-MM-DDTHH:MM:SSZ"        # ISO 8601 UTC timestamp of when review ran
plan_file: "{padded}-{plan}-PLAN.md"    # example: "26-01-PLAN.md"
criteria_reviewed: 5                    # integer -- total success_criteria entries in PLAN.md
testable_autonomous: 3                  # integer -- criteria assessable by exit code or HTTP status
needs_human: 2                          # integer -- criteria requiring manual_review classification
proposed_criteria_count: 5              # integer -- total entries in Proposed EVAL-CONFIG.yml Entries section
---
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `phase` | string | Phase identifier in format `{XX}-{phase-name}` |
| `reviewed` | string | ISO 8601 UTC timestamp of review |
| `plan_file` | string | Filename of the PLAN.md that was reviewed |
| `criteria_reviewed` | integer | Count of success_criteria entries read from PLAN.md |
| `testable_autonomous` | integer | Count classified as autonomously testable (ui_behavior, api_assertion, design_token, or unit_test) |
| `needs_human` | integer | Count classified as requiring manual_review |
| `proposed_criteria_count` | integer | Count of entries in the Proposed EVAL-CONFIG.yml Entries section |

Invariant: `testable_autonomous + needs_human == criteria_reviewed` and `proposed_criteria_count == criteria_reviewed`.

---

## Markdown Body Structure

The body must contain these sections in the following order:

```markdown
# Sprint Contract: Phase {N} -- Plan {Y}

**Reviewed:** {ISO timestamp}
**Plan file:** {padded}-{plan}-PLAN.md
**Criteria reviewed:** {N}
**Autonomously testable:** {N}
**Needs human review:** {N}

---

## Criteria Testability Review

| Criterion | Testable? | Proposed Type | Test Approach | Notes |
|-----------|-----------|---------------|---------------|-------|
| {criterion text from PLAN.md} | Yes | ui_behavior | Playwright: {test file} -- {grep pattern} | {any notes} |
| {criterion text from PLAN.md} | Yes | api_assertion | HTTP {method} {url} expects {status} | {any notes} |
| {criterion text from PLAN.md} | No | manual_review | Human review required | Contains "{trigger word}" |

## Proposed EVAL-CONFIG.yml Entries

The following YAML entries are ready to paste into {padded-phase}-EVAL-CONFIG.yml.
Review and merge entries that accurately reflect the implementation intent.

```yaml
criteria:
  - id: UI-01
    type: ui_behavior
    description: "{criterion text}"
    playwright_test: "tests/e2e/playwright/{file}.test.ts"
    grep_pattern: "{test name pattern}"

  - id: API-01
    type: api_assertion
    description: "{criterion text}"
    method: GET
    url: "/api/{path}"
    body: null
    auth: "test-user"
    expected_status: 200

  - id: MANUAL-01
    type: manual_review
    description: "{criterion text}"
    review_guidance: "{specific guidance for the reviewer}"
```

## Evaluator Notes

{Observations about testability gaps, ambiguous criteria, or suggestions for improving criterion precision}

- {Note 1}: {observation}
- {Note 2}: {observation or suggestion}
```

**Section presence rules:**

| Section | Required | Notes |
|---------|----------|-------|
| Criteria Testability Review | Always | One row per criterion from PLAN.md |
| Proposed EVAL-CONFIG.yml Entries | Always | One entry per criterion; manual_review for non-testable |
| Evaluator Notes | When relevant | Omit if no observations to add |

---

## Testability Decision Rules

A criterion is autonomously testable (Yes) if and only if it meets one of these conditions:

1. Can be verified by running a Playwright test and checking the exit code -- use type `ui_behavior`
2. Can be verified by an HTTP request checking status code and optionally response body -- use type `api_assertion`
3. Can be verified by running `node scripts/token-audit.js` and checking the exit code -- use type `design_token`
4. Can be verified by running vitest on a specific test file and checking the exit code -- use type `unit_test`

A criterion must be classified as `manual_review` if any of these apply:

1. Contains subjective language: "appropriate", "clear", "professional", "intuitive", "looks correct", "feels right", "user-friendly", "reasonable", "good"
2. Requires comparing states that cannot be asserted programmatically (e.g., "the UI is consistent with the design")
3. Requires domain expertise or user context to assess (e.g., "the workflow creation experience is smooth")
4. Describes a quality attribute rather than a behavioral assertion (e.g., "error messages are helpful")

When in doubt: if you cannot write the exact command that would produce a pass/fail exit code, classify as manual_review.

---

## Integration with EVAL-CONFIG.yml

After gsd-evaluator writes the sprint contract, execute-phase presents it for review. Accepted entries are merged into the plan's EVAL-CONFIG.yml before gsd-executor runs. The contract file is retained for audit in the phase directory.

In auto mode (`auto_advance: true`): execute-phase auto-accepts all proposed entries and merges them into EVAL-CONFIG.yml without human review. This enables fully autonomous pipeline operation.

In interactive mode: execute-phase displays the sprint contract and waits for human confirmation before merging. The human can accept all, reject individual entries, or modify proposed entries before the build begins.

The sprint contract file (`{padded-phase}-{plan}-SPRINT-CONTRACT.md`) is never overwritten. If multiple sprint contract reviews run for the same plan (e.g., after a plan revision), a new file is written with a revision suffix: `{padded-phase}-{plan}-SPRINT-CONTRACT-R2.md`.
