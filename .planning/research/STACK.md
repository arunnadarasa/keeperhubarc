# Stack Research

**Domain:** Autonomous build-evaluate loop for Web3 workflow automation platform (KeeperHub v1.6)
**Researched:** 2026-03-29
**Confidence:** HIGH (core Playwright APIs verified against official docs; Vercel AI SDK verified against ai-sdk.dev; git worktree patterns verified against multiple sources)

---

## Context: What Already Exists (Do NOT Re-add)

This is a subsequent-milestone stack. These technologies are already installed and tested:

| Already Have | Version | Do Not Re-add |
|-------------|---------|---------------|
| `@playwright/test` | ^1.58.2 | All Playwright browser/API test primitives, webServer config, APIRequestContext |
| `vitest` | ^4.0.15 | Unit and integration test runner |
| `zod` | ^4.3.6 | Schema validation (Zod v4 -- breaking API vs Zod v3, already in use) |
| `ai` (Vercel AI SDK) | ^5.0.157 | `generateText` with `Output.object()`, streaming |
| `@ai-sdk/anthropic` | ^2.0.70 | Claude model provider |
| `tsx` | ^4.21.0 | TypeScript execution for scripts |
| `dotenv` / `dotenv-expand` | installed | Environment variable loading |
| Playwright global-setup/teardown | existing | `seedPersistentTestUsers`, `cleanupPersistentTestUsers` |
| scripts/seed/ | existing | `seed-user.ts`, `seed-test-wallet.ts`, `seed-test-workflow.ts`, etc. |
| `.claude/agents/` | existing | orchestrator, builder, verifier, researcher, debugger |
| GSD pipeline | existing | `execute-phase.md`, `execute-plan.md`, subagent spawn via `Task()` |
| `mcp__playwright__*` | local MCP | Playwright MCP server already configured in `.mcp.json` |

---

## Recommended Stack: New Capabilities Only

The answer to "what new npm packages are needed" is: **none**. Every required primitive is already installed. The v1.6 milestone consists entirely of new source files (TypeScript scripts, agent markdown files, config files) that wire together existing dependencies.

### Core Technologies (already installed, newly applied)

| Technology | Current Version | New Application | Why This is the Right Primitive |
|------------|----------------|-----------------|--------------------------------|
| `@playwright/test` webServer config | ^1.58.2 | Start/manage Next.js dev server for eval runs | `webServer` in `playwright.config.ts` handles full lifecycle: spawn, URL readiness poll, graceful shutdown, port management. Zero new dependencies. The existing `playwright.config.ts` omits `webServer` entirely (assumes running server); the new `playwright.evaluate.config.ts` adds it. Verified: [playwright.dev/docs/test-webserver](https://playwright.dev/docs/test-webserver) |
| `@playwright/test` APIRequestContext | ^1.58.2 | HTTP assertions against backend API endpoints | `request` fixture provides `get()`, `post()`, `fetch()` with `expect(response).toBeOK()` and `expect(response.json()).toMatchObject()`. Auth state is shared with browser context automatically. No axios, supertest, or node-fetch needed. Verified: [playwright.dev/docs/api-testing](https://playwright.dev/docs/api-testing) |
| `@playwright/test` JSON reporter | ^1.58.2 | Machine-readable test results for scoring | Built-in `json` reporter outputs structured pass/fail/error data per test to a file. The scorer reads this file to compute weighted scores. Config: `reporter: [['json', { outputFile: '.claude/eval-results.json' }]]`. Verified: [playwright.dev/docs/test-reporters](https://playwright.dev/docs/test-reporters) |
| `ai` (Vercel AI SDK v5) | ^5.0.157 | LLM-based UI/UX quality scoring with structured output | `generateText({ output: Output.object({ schema: zodSchema }) })` with `@ai-sdk/anthropic` produces calibrated criterion-by-criterion scores as validated JSON. AI SDK v5 uses `Output.object()` (not top-level `generateObject` -- verify import before use). Verified: [ai-sdk.dev/docs/ai-sdk-core/generating-structured-data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data) |
| `zod` v4 | ^4.3.6 | Schema definitions for evaluation rubric and score types | Defines `EvalScoreSchema`, `CriterionResultSchema`, and LLM output schemas. `z.object().safeParse()` validates scorer output before writing `.claude/eval-score.json`. Zod v4 API (not v3 -- breaking differences) is already in use across the codebase. |
| `tsx` | ^4.21.0 | Run evaluation scripts outside Playwright test runner | `tsx scripts/evaluate/score.ts` and `tsx scripts/evaluate/criteria-scorer.ts` are invoked by the evaluator agent as shell commands. Already installed as devDep. |
| `git worktree` (builtin) | git | Filesystem isolation for parallel build + evaluate agents | `git worktree add .claude/worktrees/eval-round-N staging` creates an isolated working directory for each eval round. The evaluator starts its dev server in the worktree copy so the builder continues unblocked. Claude Code v2.1.49+ supports native `--worktree` flag; agent frontmatter supports `isolation: worktree`. No npm package needed. |

### New Source Files to Create (zero new dependencies)

These are new TypeScript scripts and agent files -- they use only already-installed libraries:

| File | Type | Purpose | Dependencies Used |
|------|------|---------|-------------------|
| `playwright.evaluate.config.ts` | Playwright config | Eval-specific config: webServer, JSON reporter, port 3001, no retries | `@playwright/test`, `dotenv-expand` |
| `tests/e2e/playwright/evaluate/` | Directory | Playwright test suite for evaluation (separate from dev E2E tests) | `@playwright/test`, existing auth/seed/workflow utils |
| `tests/e2e/playwright/evaluate/ui-eval.test.ts` | Playwright test | UI behavior assertions against live dev server | `@playwright/test`, existing `discover` and `probe` utilities |
| `tests/e2e/playwright/evaluate/api-eval.test.ts` | Playwright test | HTTP assertions against backend API endpoints | `@playwright/test` `request` fixture |
| `scripts/evaluate/score.ts` | Script | Reads Playwright JSON output, applies criterion weights, computes PASS/FAIL | `zod`, `node:fs`, `node:path` |
| `scripts/evaluate/criteria-scorer.ts` | Script | LLM rubric scoring for UI/UX criteria that Playwright cannot assert | `ai`, `@ai-sdk/anthropic`, `zod` |
| `scripts/evaluate/seed-eval.ts` | Script | Seeds minimal test data for eval run (API key auth only, no OTP) | Existing seed utilities from `scripts/seed/` |
| `.claude/agents/evaluator.md` | Agent definition | 6th agent: starts dev server, runs eval suite, scores, reports verdict | Claude Code agent system |
| `.claude/commands/evaluate.md` | Command | `/evaluate` slash command for single-round build-evaluate | Claude Code command system |
| `.claude/commands/autonomous-build.md` | Command | Multi-round build-QA loop with configurable round cap | Claude Code command system |

---

## Architecture for Each Capability

### (1) Runtime UI Evaluation via Playwright Against a Live Dev Server

**No new dependencies.** Pattern: `playwright.evaluate.config.ts` with `webServer` block.

```typescript
// playwright.evaluate.config.ts
export default defineConfig({
  testDir: './tests/e2e/playwright/evaluate',
  reporter: [['json', { outputFile: '.claude/eval-results.json' }]],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3001',
    reuseExistingServer: false,     // always fresh for eval -- never reuse
    timeout: 120_000,
    env: { PORT: '3001', NODE_ENV: 'test' },
    stdout: 'pipe',
  },
  use: { baseURL: 'http://localhost:3001' },
  workers: 1,
  retries: 0,                       // fail fast, don't hide flakiness from scoring
});
```

Key decisions:
- Port 3001 (not 3000) avoids conflict with the developer's running instance.
- `reuseExistingServer: false` guarantees the evaluated code is the code under test.
- `retries: 0` because the evaluator needs accurate PASS/FAIL signals, not flakiness-masked results.
- `stdout: 'pipe'` captures Next.js startup output for debugging slow starts.

Playwright's built-in `webServer` polls the URL until 200/redirect, then spawns tests, then SIGTERMs. No process manager (pm2, concurrently) is needed.

### (2) Backend API Evaluation via HTTP Assertions

**No new dependencies.** Pattern: `request` fixture from already-installed `@playwright/test`.

```typescript
// tests/e2e/playwright/evaluate/api-eval.test.ts
import { test, expect } from '@playwright/test';

test('execution endpoint returns executionId', async ({ request }) => {
  const response = await request.post('/api/v1/execute/transfer', {
    headers: { Authorization: `Bearer ${process.env.EVAL_API_KEY}` },
    data: { chainId: '1', recipient: '0x...', amount: '1000000' },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body).toMatchObject({ executionId: expect.any(String) });
});
```

`APIRequestContext` shares cookies/session state with the browser context. The `EVAL_API_KEY` is seeded by `scripts/evaluate/seed-eval.ts` before the test run and written to a temp env file.

### (3) Multi-Round Build-QA Orchestration

**No new npm packages.** Pure agent coordination logic.

The orchestrator runs rounds of: spawn builder agent -> spawn evaluator agent -> read score from `.claude/eval-score.json` -> decide continue/stop. This is orchestration in `.claude/commands/autonomous-build.md` using the existing GSD `Task()` spawn pattern from `execute-phase.md`.

Round cap is a configurable constant (default: 3) checked before spawning a new round. Between rounds the orchestrator reads:
- `.claude/eval-results.json` -- Playwright JSON reporter output (raw pass/fail per test)
- `.claude/eval-score.json` -- Aggregated weighted score with criterion breakdown

Git worktrees provide build/evaluate isolation: each eval round runs `pnpm dev` in its own worktree at `.claude/worktrees/eval-round-N` so the builder can continue working on the main checkout.

```
DECOMPOSE -> RESEARCH -> IMPLEMENT -> VERIFY -> EVALUATE -> PR
                                         |                   ^
                                         +-- FAIL -> IMPLEMENT (round N+1, up to cap)
```

The EVALUATE stage is a new pipeline stage inserted between VERIFY and PR in `orchestrator.md`.

### (4) Calibrated Scoring With Hard Thresholds

**No new dependencies.** Two-layer scoring using existing `zod` + existing `ai` SDK.

**Layer 1 -- Structural scoring** (zero LLM cost): `scripts/evaluate/score.ts` reads Playwright JSON output and maps test PASS/FAIL to weighted criteria scores.

```typescript
// scripts/evaluate/score.ts
import { z } from 'zod';
import { readFileSync, writeFileSync } from 'node:fs';

const CriterionResultSchema = z.object({
  criterion: z.string(),
  weight: z.number().min(0).max(1),
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  passed: z.boolean(),
  evidence: z.array(z.string()),
});

const EvalScoreSchema = z.object({
  totalScore: z.number().min(0).max(1),
  passed: z.boolean(),        // true iff totalScore >= PASS_THRESHOLD and no criterion below its threshold
  criteria: z.array(CriterionResultSchema),
  failedCriteria: z.array(z.string()),
  round: z.number().int(),
});
```

Hard threshold rule: any criterion with `score < criterion.threshold` fails the round regardless of `totalScore`. This prevents a strong result on easy tests from masking a complete failure on a critical criterion.

Pass threshold: default `totalScore >= 0.8` (configurable per plan via success criteria frontmatter).

**Layer 2 -- LLM rubric scoring** (for UI/UX criteria): `scripts/evaluate/criteria-scorer.ts` uses `Output.object()` to ask Claude to rate a screenshot against `specs/design-system/` token spec.

```typescript
// scripts/evaluate/criteria-scorer.ts
import { generateText, Output } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const UiCriterionScoreSchema = z.object({
  score: z.number().min(0).max(1).describe('0=complete failure, 0.5=partial, 1=fully correct'),
  rationale: z.string().describe('specific evidence from the screenshot'),
  violations: z.array(z.string()).describe('specific token violations found'),
});

const { output } = await generateText({
  model: anthropic('claude-sonnet-4-6'),
  output: Output.object({ schema: UiCriterionScoreSchema }),
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: rubricPrompt },
      { type: 'image', image: screenshotBuffer },
    ],
  }],
});
// output is fully typed as z.infer<typeof UiCriterionScoreSchema>
```

LLM scoring is only used when Playwright assertions cannot cover the criterion (e.g., visual design token compliance). It is not used for functional correctness tests.

**Important:** Verify `Output` is a named export from `ai` v5 before using. The AI SDK v5 changed from top-level `generateObject()` to `generateText({ output: Output.object() })`. If `Output` is not exported at the top level, check `ai/core` or `@ai-sdk/core`.

### (5) Integration With Claude Code Agent System

**No new dependencies.** New `evaluator` agent follows existing agent patterns from `.claude/agents/`.

The evaluator agent is a read-execute agent (like verifier but with Bash write access for running scripts):

```markdown
---
name: evaluator
description: Evaluates built features against success criteria using Playwright tests and LLM scoring.
  Use when the Orchestrator delegates an EVALUATE stage task.
tools: Read, Bash, Grep, Glob
model: sonnet
---
```

Evaluator workflow:
1. Read the plan's success criteria to determine what to evaluate.
2. Run `tsx scripts/evaluate/seed-eval.ts` to seed minimal test data.
3. Run `pnpm playwright test --config playwright.evaluate.config.ts` (starts dev server via webServer config).
4. Run `tsx scripts/evaluate/score.ts` to compute weighted aggregate score.
5. For UI criteria requiring visual inspection: run `tsx scripts/evaluate/criteria-scorer.ts`.
6. Write `EvalReport` to `.claude/eval-report.md` (PASS/FAIL, score, criterion breakdown, recommended fixes).
7. Return PASS or FAIL with the report path to the orchestrator.

The orchestrator reads the `EvalReport`, decides to proceed to PR (PASS) or route back to builder (FAIL, up to round cap).

---

## New `package.json` Scripts

Add these to `package.json` scripts -- no new dependencies:

```json
{
  "eval": "playwright test --config playwright.evaluate.config.ts",
  "eval:score": "tsx scripts/evaluate/score.ts",
  "eval:seed": "tsx scripts/evaluate/seed-eval.ts"
}
```

---

## Playwright Config Separation

The separation between `playwright.config.ts` (existing) and `playwright.evaluate.config.ts` (new) is architecturally important:

| Concern | `playwright.config.ts` (existing) | `playwright.evaluate.config.ts` (new) |
|---------|-----------------------------------|---------------------------------------|
| Purpose | Developer E2E tests, CI pipeline | Autonomous evaluation of built features |
| webServer | None (assumes running server or BASE_URL env) | Always starts `pnpm dev` on port 3001 |
| Reporter | list (local), github+html (CI) | json -> `.claude/eval-results.json` |
| Auth setup | `auth.setup.ts` with OTP via DB query | `seed-eval.ts` via API key (no OTP, no browser auth flow) |
| testDir | `tests/e2e/playwright` | `tests/e2e/playwright/evaluate` |
| workers | 1 | 1 (serialized for deterministic scoring) |
| retries | 2 (hides flakiness in CI) | 0 (accurate failure signals for scoring) |
| reuseExistingServer | `!process.env.CI` | Always false |

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Playwright `webServer` config | `node:child_process.spawn()` managed manually | More code, no built-in URL readiness polling, no graceful shutdown handling. `webServer` is the right primitive -- already works with Next.js per existing tests. |
| Playwright APIRequestContext | axios / node-fetch / supertest | Extra dependencies; no unified auth state with browser context; Playwright already handles HTTP assertions with expect matchers. |
| Vercel AI SDK `Output.object()` | promptfoo / deepeval / braintrust | Full eval frameworks designed for LLM output quality testing -- overkill and bring heavy dependencies + separate config formats. The AI SDK + Zod already installed covers purpose-fit criterion scoring. |
| Custom `score.ts` with Zod schemas | Vitest/Jest `expect` matchers for scoring | Test assertions are binary (pass/fail). Scoring needs weighted numeric aggregation with per-criterion thresholds. Custom scorer is 50 lines of TypeScript and is fully type-safe via Zod. |
| Git worktrees via `git worktree add` | Full repo clone for isolation | Clones are slow and waste disk. Worktrees share `.git` and take seconds. Claude Code v2.1.49+ supports this natively. |
| Separate `playwright.evaluate.config.ts` | Modify existing `playwright.config.ts` | Existing config has auth project dependencies, CI reporters, retry logic. Eval needs a clean independent config. Modifying the existing config would couple dev E2E and eval concerns. |
| Agent orchestration via Claude Code `Task()` | Custom Node.js process manager for rounds | `Task()` is what the existing pipeline uses. Consistent with SAFE-02 iteration limit safeguard. No new orchestration framework needed. |
| LLM scoring via `criteria-scorer.ts` (Layer 2 only) | LLM scoring for all criteria | LLM time and cost should be reserved for criteria that Playwright cannot assert (visual/UX). Structural and functional criteria are cheaper and more reliable via Playwright pass/fail. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Any new npm package for this milestone | All required primitives are installed | Wire existing `@playwright/test`, `ai`, `zod`, `tsx` |
| `jest` | Already have vitest; two test runners creates confusion | vitest (already installed, not used for eval -- Playwright handles it) |
| `supertest` | Playwright's `request` fixture does HTTP assertions with shared auth state | `request` fixture from `@playwright/test` |
| `promptfoo` / `deepeval` | Full eval frameworks for LLM quality testing -- overkill for runtime UI/API evaluation | Custom `criteria-scorer.ts` (50 lines) |
| `pm2` | Process manager for Next.js dev server | Playwright `webServer` config handles lifecycle |
| `wait-on` | Port/URL polling utility | Playwright `webServer` `url` option does this natively |
| `concurrently` | Multi-process runner | Not needed; eval uses one dev server per config |
| `@playwright/mcp` (npm) | Would duplicate already-configured local MCP server | Existing `mcp__playwright__*` in `.mcp.json` |
| k6 / artillery | Load testing -- not the goal; functional correctness is | Playwright HTTP assertions |
| Zod v3 patterns | Project is on Zod v4 (`^4.3.6`); `z.string().email()` and other APIs differ | Zod v4 API only |
| Top-level `generateObject` from `ai` v5 | API changed in v5 -- verify before use | `generateText({ output: Output.object({...}) })` pattern |

---

## Version Compatibility Notes

| Package | Version | Note |
|---------|---------|------|
| `@playwright/test` ^1.58.2 | `next` 16.2.1 | `webServer` with `pnpm dev` + `reuseExistingServer: false` works against Next.js dev server. Use distinct port (3001) to avoid conflicts with the developer's running instance on 3000. |
| `ai` ^5.0.157 | `@ai-sdk/anthropic` ^2.0.70 | AI SDK v5 uses `Output.object()` pattern. Verify import: `import { generateText, Output } from 'ai'`. Do NOT assume `generateObject` exists as a named export -- it may be internal or renamed in v5. |
| `zod` ^4.3.6 | `ai` ^5.x | AI SDK v5 accepts Zod v4 schemas in `Output.object()`. Do not mix Zod v3 syntax (e.g., `.optional()` behavior differs). The rest of the codebase uses Zod v4 already. |
| `tsx` ^4.21.0 | `@types/node` ^24 | tsx runs fine with Node 24. Scripts in `scripts/evaluate/` should use `node:` prefix for built-in imports (`node:fs`, `node:path`). |
| `@playwright/test` webServer | `pnpm dev` startup time | Next.js dev server cold start can exceed 30s. Set `timeout: 120_000` in `webServer` config. |

---

## Sources

- [playwright.dev/docs/test-webserver](https://playwright.dev/docs/test-webserver) -- webServer config options, lifecycle management, reuseExistingServer (HIGH confidence, official docs)
- [playwright.dev/docs/api-testing](https://playwright.dev/docs/api-testing) -- APIRequestContext HTTP assertions (HIGH confidence, official docs)
- [playwright.dev/docs/test-reporters](https://playwright.dev/docs/test-reporters) -- JSON reporter format and custom Reporter interface (HIGH confidence, official docs)
- [ai-sdk.dev/docs/ai-sdk-core/generating-structured-data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data) -- AI SDK v5 Output.object() pattern with Zod (HIGH confidence, official docs)
- [claudefa.st/blog/guide/development/worktree-guide](https://claudefa.st/blog/guide/development/worktree-guide) -- Claude Code v2.1.49 native worktree support (MEDIUM confidence, third-party blog consistent with multiple sources)
- Codebase: `playwright.config.ts`, `package.json`, `.claude/agents/`, `scripts/seed/` -- confirmed all "already installed" claims (HIGH confidence, direct inspection)

---
*Stack research for: KeeperHub v1.6 autonomous build-evaluate loop*
*Researched: 2026-03-29*
