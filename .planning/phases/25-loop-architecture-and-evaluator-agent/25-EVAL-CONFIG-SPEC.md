# EVAL-CONFIG.yml Format Specification

## Purpose

EVAL-CONFIG.yml is written by gsd-planner during the plan-phase for phases requiring runtime evaluation. It is read by execute-phase to decide whether to spawn gsd-evaluator (presence of file = spawn; absence = skip evaluation entirely), and by gsd-evaluator to configure the evaluation run (threshold, max rounds, server port, seed scripts, and criteria list).

---

## File Naming Convention

| Property | Value |
|----------|-------|
| Name | `{padded-phase}-EVAL-CONFIG.yml` |
| Example | `26-EVAL-CONFIG.yml` |
| Location | `.planning/phases/{phase-dir}/` |

**Orchestrator detection:**

```bash
EVAL_CONFIG=$(ls "${PHASE_DIR}"/*-EVAL-CONFIG.yml 2>/dev/null | head -1)
if [ -n "$EVAL_CONFIG" ]; then
  # spawn gsd-evaluator after build
fi
```

If the file does not exist, execute-phase skips evaluation entirely. This provides full backward compatibility -- all existing phases without EVAL-CONFIG.yml continue to work unchanged.

---

## Schema

### Top-Level Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `threshold` | float (0.0-1.0) | Yes | 0.85 | Fraction of autonomous criteria that must pass for approved to be true. Example: 0.85 means 85% of autonomous criteria must pass. |
| `max_rounds` | integer | Yes | 3 | Maximum evaluate-fix cycles before SAFE-02 escalation. Feeds the "build-evaluate fix rounds" counter (fifth SAFE-02 counter type). |
| `server_port` | integer | Yes | 3099 | Port for the evaluation dev server. Use a non-standard port (not 3000 or 3001) to avoid collision with the main dev instance running on 3000. |
| `seed_scripts` | list of paths | Yes | -- | Script paths to run before each evaluation round to produce deterministic test state. Always include the base seed first. |
| `criteria` | list of criterion objects | Yes | -- | Evaluation criteria. See Criterion Type Schemas below. |

### Seed Scripts Convention

```yaml
seed_scripts:
  - tests/e2e/playwright/utils/seed.ts   # base seed -- always run first
  # - scripts/seed/seed-feature.ts       # feature-specific seed -- add if needed
```

At least the base seed must be present. Seed scripts run in order before each evaluation round. If any seed script fails, `seed_ran: false` is set in EVAL.md and evaluation continues (seeds are best-effort, not a gate).

---

## Criterion Type Schemas

All criteria share the `id`, `type`, and `description` fields. Each type has additional required fields documented below.

### Type: `ui_behavior`

**Gate:** Autonomous -- Playwright exit code (exit 0 = pass, exit non-zero = fail)

**When to use:** UI interactions, form rendering, navigation, component presence, error messages that appear in the DOM.

```yaml
- id: UI-01
  type: ui_behavior
  description: "{Human-readable description of what should happen}"
  playwright_test: "tests/e2e/playwright/{file}.test.ts"
  grep_pattern: "{test name or substring for --grep flag}"
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique criterion ID in format `UI-{N}` |
| `type` | Yes | `ui_behavior` |
| `description` | Yes | Human-readable description of what the test asserts |
| `playwright_test` | Yes | Path to the .test.ts file from repo root |
| `grep_pattern` | Yes | Test name pattern passed to `--grep` flag |

### Type: `api_assertion`

**Gate:** Autonomous -- HTTP status code match, and optionally response body substring match.

**When to use:** API endpoint existence, authentication gates, response structure, error responses.

```yaml
- id: API-01
  type: api_assertion
  description: "{Human-readable description of the API assertion}"
  method: GET | POST | PUT | DELETE | PATCH
  url: "/api/{path}"
  body: '{JSON string or null}'
  auth: "test-user | none"
  expected_status: 200
  expected_body_contains: "{optional substring or JSON path expression}"
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique criterion ID in format `API-{N}` |
| `type` | Yes | `api_assertion` |
| `description` | Yes | Human-readable description |
| `method` | Yes | HTTP method in uppercase |
| `url` | Yes | Path starting with `/api/` |
| `body` | Yes | JSON string to send as request body, or `null` for no body |
| `auth` | Yes | `"test-user"` to authenticate as the seeded test user, or `"none"` for unauthenticated |
| `expected_status` | Yes | Expected HTTP status code (integer) |
| `expected_body_contains` | No | Optional substring to assert in response body |

### Type: `design_token`

**Gate:** Autonomous -- token-audit.js exit code (exit 0 = pass, exit non-zero = has violations).

**When to use:** Verifying that new UI components use design tokens (no hardcoded hex colors, arbitrary color classes).

```yaml
- id: DS-01
  type: design_token
  description: "{Human-readable description of the token compliance check}"
  token_audit: true
  files:
    - "{path/to/component.tsx}"
    - "{path/to/another-component.tsx}"
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique criterion ID in format `DS-{N}` |
| `type` | Yes | `design_token` |
| `description` | Yes | Human-readable description |
| `token_audit` | Yes | Must be `true` (activates token-audit.js) |
| `files` | Yes | List of file paths to audit from repo root |

The evaluator runs `node scripts/token-audit.js --quiet {files...}` and checks exit code.

### Type: `unit_test`

**Gate:** Autonomous -- vitest exit code (exit 0 = all specified tests pass, exit non-zero = failure).

**When to use:** Verifying business logic functions, utility modules, or any code with direct unit tests.

```yaml
- id: UNIT-01
  type: unit_test
  description: "{Human-readable description of what the unit tests verify}"
  test_file: "tests/{path/to/file}.test.ts"
  grep_pattern: "{optional test name pattern -- omit to run all tests in file}"
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique criterion ID in format `UNIT-{N}` |
| `type` | Yes | `unit_test` |
| `description` | Yes | Human-readable description |
| `test_file` | Yes | Path to the .test.ts file from repo root |
| `grep_pattern` | No | Optional test name pattern for `--grep`. Omit to run all tests in the file. |

### Type: `manual_review`

**Gate:** NEVER autonomous. Manual review criteria are never included in the autonomous pass/fail gate and never affect the `approved` boolean or score.

**When to use:** Any criterion that requires human judgment of appearance, quality, or appropriateness. See Criterion Classification Rule below.

```yaml
- id: MANUAL-01
  type: manual_review
  description: "{Criterion that cannot be asserted automatically}"
  review_guidance: "{What the reviewer should check and how to determine pass/fail}"
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique criterion ID in format `MANUAL-{N}` |
| `type` | Yes | `manual_review` |
| `description` | Yes | Human-readable description |
| `review_guidance` | Yes | What the reviewer should check; specific enough to produce a yes/no answer |

Manual review criteria appear in the `## Manual Review Needed` section of EVAL.md. They surface to human reviewers after the autonomous gate is resolved.

---

## Criterion Classification Rule

A criterion is autonomous-gateable ONLY if its pass/fail is determinable by a command exit code or an observable HTTP state assertion. Criteria requiring human judgment of appearance, quality, or appropriateness MUST use type: manual_review. Trigger words requiring manual_review: appropriate, reasonable, professional, intuitive, clear (in UI/UX context), looks correct, feels right, user-friendly.

**Autonomous-gateable examples:**
- "POST /api/workflows returns 201" -- use api_assertion
- "Login form renders email and password inputs" -- use ui_behavior
- "No hardcoded colors in dashboard.tsx" -- use design_token
- "weightedScore() returns correct value for mixed pass/fail" -- use unit_test

**Must be manual_review examples:**
- "The workflow builder looks professional" -- contains "professional"
- "Error messages are clear and helpful" -- "clear" in UI/UX context
- "The dashboard feels intuitive" -- "intuitive"
- "Color choices are appropriate for the brand" -- "appropriate"

---

## Completeness Rules

1. Every criterion must have a unique `id` in format `{TYPE-PREFIX}-{N}` where TYPE-PREFIX is one of: `UI`, `API`, `DS`, `UNIT`, or `MANUAL`.
2. `threshold` and `max_rounds` are required top-level fields. No defaults are assumed at runtime.
3. `seed_scripts` must include at least the base seed: `tests/e2e/playwright/utils/seed.ts`.
4. A phase with zero autonomous criteria should set `threshold: 0.0` (passes vacuously). Use with caution and document the reason in a comment.
5. Criterion IDs must be globally unique within the file. Duplicate IDs cause undefined behavior in scoring.

---

## Cross-Reference: EVAL-CONFIG.yml and EVAL.md

The `max_rounds` field in EVAL-CONFIG.yml feeds directly into the `max_rounds` field in every EVAL.md written by the evaluator. The `threshold` field is used during score calculation to determine the `approved` boolean in EVAL.md. This ensures the configuration is captured in the output for audit purposes.

---

## Minimal Example

A minimal working EVAL-CONFIG.yml for a phase that adds one new API endpoint and a UI component:

```yaml
# 26-EVAL-CONFIG.yml
# Evaluation configuration for Phase 26: dev-server-lifecycle
# Written by gsd-planner during plan-phase for Phase 26

threshold: 0.85
max_rounds: 3
server_port: 3099

seed_scripts:
  - tests/e2e/playwright/utils/seed.ts

criteria:
  - id: API-01
    type: api_assertion
    description: "GET /api/eval-status returns 200 with status field"
    method: GET
    url: "/api/eval-status"
    body: null
    auth: "test-user"
    expected_status: 200
    expected_body_contains: "status"

  - id: MANUAL-01
    type: manual_review
    description: "Dev server startup log is readable and informative"
    review_guidance: "Check the server startup output in EVAL.md Server Log section. Verify it shows port, environment, and ready signal clearly. A human should be able to diagnose startup issues from the log."
```
