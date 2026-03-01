<overview>
The Blueprint pipeline is the deterministic stage contract that governs all agent-mediated development work in KeeperHub. Every task flows through 5 sequential stages: DECOMPOSE, RESEARCH, IMPLEMENT, VERIFY, PR. Each stage has a defined owner, input contract, output contract, and error handling path.

This document is a reference specification -- not an agent. The Orchestrator reads this to understand how to coordinate worker agents through the pipeline. Worker agents reference it to understand their stage's expectations.
</overview>

<risk_tiers>
Every task entering the pipeline is classified into one of three risk tiers during DECOMPOSE. The tier determines autonomy level and human involvement.

**Tier 1 -- Full Auto**
- Pattern tasks following existing conventions
- Examples: add protocol definition, add plugin action step, add unit test, add webhook handler
- Pipeline runs end-to-end without human intervention
- PR can be auto-merged if CI passes

**Tier 2 -- Human Reviewed**
- New features, refactors, multi-file changes, API surface changes
- Examples: new plugin type, new API endpoint, UI component, workflow modification
- Pipeline runs end-to-end but PR requires human review before merge
- Human reviews PR diff and approves or requests changes

**Tier 3 -- Human Owned**
- Schema migrations, security code, Web3 transaction logic, auth changes, payment flows
- Examples: database migration, wallet signing logic, access control changes, credential handling
- Pipeline HALTS at DECOMPOSE and escalates to human immediately
- Human decides whether to proceed, modify scope, or handle manually

**Classification rules:**
- If the task modifies files in `lib/db/` or `drizzle/` (schema) -> Tier 3
- If the task modifies files touching private keys, signing, or transaction submission -> Tier 3
- If the task modifies auth middleware, session handling, or RBAC -> Tier 3
- If the task creates a new plugin/protocol following existing patterns -> Tier 1
- If the task adds tests for existing code -> Tier 1
- If the task creates new features or modifies existing behavior -> Tier 2
- When uncertain, classify as Tier 2 (human review provides safety net)
</risk_tiers>

<stages>

<stage name="DECOMPOSE" number="1">
**Owner:** Orchestrator (inline, not delegated)

**Input:**
- User task description (from slash command arguments or direct request)
- Project conventions from CLAUDE.md

**Process:**
1. Analyze the task to understand scope and intent
2. Classify risk tier (Tier 1, 2, or 3) using the classification rules above
3. If Tier 3: HALT immediately. Present task summary and risk justification to user. Do not proceed.
4. Break the task into concrete subtasks with file-level specificity
5. Identify research questions (patterns to discover, types to look up, conventions to verify)
6. Define success criteria that the Verifier will check

**Output -- Task Brief:**
```
TASK BRIEF
==========
Summary: [one-line task description]
Risk Tier: [1|2|3]
Tier Justification: [why this tier]

Subtasks:
1. [subtask description]
   Files: [file paths to create or modify]
2. [subtask description]
   Files: [file paths to create or modify]

Research Questions:
- [question about existing patterns, types, or conventions]
- [or "None" if pure pattern task with no unknowns]

Success Criteria:
- [criterion 1 -- must be verifiable by reading files or running commands]
- [criterion 2]
```

**Skip condition:** None. DECOMPOSE always runs.
**Error handling:** If task description is ambiguous, Orchestrator asks user for clarification before proceeding.
</stage>

<stage name="RESEARCH" number="2">
**Owner:** Researcher agent

**Input:**
- Research questions from the Task Brief
- File paths to examine from the Task Brief

**Process:**
1. For each research question, explore the codebase using Grep, Glob, and Read
2. Read referenced files to discover existing patterns and type signatures
3. Read scoped CLAUDE.md files in relevant directories for conventions
4. Trace import chains to understand module dependencies
5. Find the most similar existing implementation as a reference pattern
6. Record exact file paths and line numbers for all findings

**Output -- Research Report:**
```
RESEARCH REPORT
===============

Question 1: [question text]
Answer: [answer with specifics]
References:
- [file:line] - [what was found]
- [file:line] - [what was found]

Question 2: [question text]
Answer: [answer with specifics]
References:
- [file:line] - [what was found]

Patterns Discovered:
- [pattern name]: [description] (see [file:line])

Type Signatures Needed:
- [type/interface name] from [file] -- [relevant fields]

Recommended Approach: [synthesis of findings into implementation guidance]

Unresolved Questions:
- [question that could not be answered, if any]
```

**Skip condition:** If DECOMPOSE produces zero research questions (pure pattern task where all conventions are known), skip directly to IMPLEMENT. The Orchestrator decides whether to skip.
**Error handling:** If a research question cannot be answered from the codebase, include it in "Unresolved Questions" and let the Orchestrator decide whether to proceed or ask the user.
</stage>

<stage name="IMPLEMENT" number="3">
**Owner:** Builder agent

**Input:**
- Task Brief from DECOMPOSE
- Research Report from RESEARCH (if produced)

**Process:**
1. Read the implementation brief and research report
2. Read relevant existing code (referenced files, sibling implementations)
3. Read scoped CLAUDE.md files in the target directory
4. Create or modify files according to the brief's subtask list
5. Run `pnpm discover-plugins` if plugin or protocol files were created or modified
6. Run `pnpm check` (lint) -- if failures, read `.claude/lint-output.txt`, fix issues, re-run
7. Run `pnpm type-check` (TypeScript) -- if failures, read `.claude/typecheck-output.txt`, fix issues, re-run
8. Report results with exact file paths and check statuses

**Output -- Implementation Report:**
```
IMPLEMENTATION REPORT
=====================
Status: [PASS|FAIL]

Files Created:
- [path]: [description]

Files Modified:
- [path]: [description]

Lint: [PASS|FAIL]
Type Check: [PASS|FAIL]
Discover Plugins: [RAN|SKIPPED] [result if ran]

Issues (if FAIL):
- [issue description with file:line reference]
```

**Iteration:** If lint or type-check fails, Builder fixes and re-runs (up to 2 rounds). After 2 failures on the same issue, Builder reports FAIL and the Orchestrator routes to Debugger.
**Error handling:** Builder NEVER creates PRs or branches. Builder reports exact failure details so the Orchestrator can route appropriately.
</stage>

<stage name="VERIFY" number="4">
**Owner:** Verifier agent

**Input:**
- List of files created/modified from IMPLEMENT
- Original Task Brief from DECOMPOSE (including success criteria)

**Process:**
1. Read all created and modified files
2. Check each file follows KeeperHub conventions (keeperhub/ directory, proper imports, no emojis, "use step" compliance)
3. Run automated checks:
   - `pnpm check` -- lint must pass
   - `pnpm type-check` -- TypeScript must pass
   - `pnpm vitest run [relevant-test-files]` -- unit tests must pass (if test files exist)
4. Validate each success criterion from the Task Brief
5. Check for regressions (TODO/FIXME markers, unrelated file modifications)
6. Produce verdict: APPROVED or REJECTED

**Output -- Verification Report:**
```
VERIFICATION REPORT
===================
APPROVED: [true|false]

Automated Checks:
- Lint (pnpm check): [PASS|FAIL]
- Type Check (pnpm type-check): [PASS|FAIL]
- Unit Tests: [PASS|FAIL|NO_TESTS] [details]
- Build (pnpm build): [PASS|FAIL]

Success Criteria:
1. [criterion text]: [PASS|FAIL] [evidence]
2. [criterion text]: [PASS|FAIL] [evidence]

Convention Compliance:
- keeperhub/ directory: [PASS|FAIL]
- "use step" patterns: [PASS|FAIL|N/A]
- No emojis: [PASS|FAIL]
- Plugin registration: [PASS|FAIL|N/A]

Issues Found:
- [issue description with file:line reference]

Recommendation: [APPROVE and proceed to PR | REJECT with fixes needed]
```

**Gate:** If APPROVED is false, Orchestrator routes failure details back to Builder (or Debugger for test/build failures). Maximum 2 verify-implement loops before escalating to human.
**Error handling:** Verifier NEVER modifies files. If a success criterion cannot be verified automatically, mark it as MANUAL_REVIEW_NEEDED and include in the report.
</stage>

<stage name="PR" number="5">
**Owner:** Orchestrator (inline, not delegated)

**Precondition:** VERIFY returned APPROVED: true

**Input:**
- Verified file list from IMPLEMENT
- Task Brief from DECOMPOSE (summary, risk tier, success criteria)
- Verification Report from VERIFY

**Process:**
1. Create a git branch following naming convention: `feature/description-in-kebab-case`
2. Stage all created/modified files (individually, never `git add .`)
3. Commit with conventional commit format: `{type}: {description}`
4. Run `pnpm build` as final gate -- must pass before PR creation
5. Push branch and create PR targeting `staging` branch
6. PR title follows conventional commit format
7. PR body includes: summary, files modified, risk tier, test results, verification status

**Output:**
- PR URL
- Branch name
- Commit hash

**Gate by risk tier:**
- Tier 1: PR created. Can be auto-merged if CI passes.
- Tier 2: PR created. Human review required before merge.
- Tier 3: Pipeline already halted at DECOMPOSE. This stage is never reached for Tier 3 tasks.

**Error handling:** If `pnpm build` fails at this stage, route back to Builder/Debugger for fix. Do not create PR with failing build.
</stage>

</stages>

<error_handling>
**Escalation chain:**

```
Builder fails (2 rounds)
  -> Orchestrator invokes Debugger with failure details
    -> Debugger investigates and fixes
      -> Builder re-verifies (lint, type-check)
        -> If still failing: Debugger gets one more attempt
          -> If Debugger fails: Escalate to human with diagnostic report

Verifier rejects (APPROVED: false)
  -> Orchestrator routes rejection details to Builder
    -> Builder fixes issues
      -> Verifier re-verifies
        -> If rejected again: Escalate to human with both rejection reports

Build fails at PR stage
  -> Route to Builder/Debugger
    -> Fix and re-run build
      -> If still failing: Escalate to human
```

**Maximum iteration limits:**
- Builder lint/type-check fix attempts: 2 per issue
- Verify-implement loops: 2
- Debugger fix attempts: 2
- After any limit is reached: escalate to human with full diagnostic context

**Escalation to human includes:**
- Original task description
- Risk tier and justification
- All error messages and stack traces
- Files involved
- What was attempted and why it failed
- Recommended manual action
</error_handling>

<state_format>
Each stage produces a structured output (shown above) that becomes the next stage's input. State is passed as plain text between agents for readability and debuggability.

**State flow:**
```
User Request
  -> [DECOMPOSE] -> Task Brief
    -> [RESEARCH] -> Research Report (or skipped)
      -> [IMPLEMENT] -> Implementation Report
        -> [VERIFY] -> Verification Report
          -> [PR] -> PR URL
```

All intermediate state is ephemeral -- it exists only in the agent conversation context. The permanent artifacts are the code changes and the PR.

**No parallel execution in v1.4:** Stages run strictly sequentially. One stage must complete before the next begins. Parallel agent execution within stages is a future enhancement.
</state_format>

<ci_gates>
**Planned CI gates (Phase 16 will enforce these):**
- `pnpm build` must pass before PR creation (Builder should catch this, but PR stage double-checks)
- `pnpm check` (lint) must pass
- `pnpm type-check` (TypeScript) must pass
- Verifier approval required (APPROVED: true)

These gates exist in the pipeline specification now so that all agents are aware of them, even before Phase 16 adds enforcement tooling.
</ci_gates>
