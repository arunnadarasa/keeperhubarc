# Roadmap: KeeperHub

## Milestones

- ✅ **v1.0 Service Extraction** - Phases 1-4 (shipped 2026-02-12)
- ✅ **v1.1 OG Image Generation** - Phase 5 (shipped 2026-02-12)
- ✅ **v1.2 Protocol Registry** - Phases 6-9 (shipped 2026-02-20)
- ✅ **v1.3 Direct Execution API** - Phases 10-12 (shipped 2026-02-20)
- **v1.4 Agent Team** - Phases 13-16 (in progress)

## Phases

<details>
<summary>✅ v1.0 Service Extraction (Phases 1-4) - SHIPPED 2026-02-12</summary>

- [x] Phase 1: Events Extraction - completed 2026-01-25
- [x] Phase 2: Scheduler APIs (5/5 plans) - completed 2026-01-26
- [x] Phase 3: Scheduler Extraction (4/4 plans) - completed 2026-01-26
- [x] Phase 4: Cleanup (3/3 plans) - completed 2026-02-12

See: `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.1 OG Image Generation (Phase 5) - SHIPPED 2026-02-12</summary>

- [x] Phase 5: Build & Local Validation (2/2 plans) - completed 2026-02-12

Phase 6 (Meta Tags & Social Validation) dropped from scope -- deferred to future milestone.

See: `.planning/milestones/v1.1-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.2 Protocol Registry (Phases 6-9) - SHIPPED 2026-02-20</summary>

- [x] **Phase 6: Foundations** - Protocol types, defineProtocol() function, read/write-contract core extraction (completed 2026-02-19)
- [x] **Phase 7: Plugin Auto-Generation** - protocolToPlugin(), generic protocol steps, discover-plugins extension (completed 2026-02-19)
- [x] **Phase 8: ABI Resolution + Example Protocol** - ABI auto-fetch with caching, WETH example definition (completed 2026-02-20)
- [x] **Phase 9: Hub UI** - Protocols tab, protocol grid, inline detail view, action rows (completed 2026-02-20)

See: `.planning/milestones/v1.2-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.3 Direct Execution API (Phases 10-12) - SHIPPED 2026-02-20</summary>

- [x] **Phase 10: Foundation** - DB tables, core function adaptations, and execution infrastructure (_lib/ middleware) (completed 2026-02-20)
- [x] **Phase 11: Core Endpoints** - transfer, contract-call, swap placeholder, status endpoint, validation, ABI resolution, audit logging (completed 2026-02-20)
- [x] **Phase 12: Check-and-Execute** - Conditional execution endpoint composing read + condition + write (completed 2026-02-20)

Verified by 27 integration tests in `tests/integration/direct-execution-api.test.ts`.

See: `.planning/milestones/v1.3-ROADMAP.md` for full details.

</details>

### v1.4 Agent Team

**Milestone Goal:** Build a 5-agent Claude Code team that automates general KeeperHub development -- plugins, protocols, features, tests, and bug fixes -- through a deterministic Blueprint pipeline with tiered autonomy.

- [x] **Phase 13: Foundation** - Vitest skill, scoped CLAUDE.md files, pnpm build CI check (completed 2026-03-01)
- [x] **Phase 14: Agent Team** - 5 agent definitions (Orchestrator, Builder, Verifier, Researcher, Debugger) and Blueprint pipeline specification (completed 2026-03-01)
- [x] **Phase 15: Pipeline Commands** - /add-protocol, /add-plugin, /add-feature slash commands using the agent pipeline (completed 2026-03-01)
- [ ] **Phase 16: Safeguards** - Human review gate, 2-round iteration limit, build verification, Verifier approval gate

## Phase Details

### Phase 13: Foundation
**Goal**: Prerequisite infrastructure exists so agents can write verified, CI-passing code
**Depends on**: Nothing (first phase of v1.4)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04
**Success Criteria** (what must be TRUE):
  1. Running the Vitest skill on a plugin step file produces a passing test suite with meaningful coverage
  2. Agents reading keeperhub/plugins/ receive plugin-specific standards (structure, "use step" constraints, lint rules) via scoped CLAUDE.md
  3. Agents reading tests/e2e/playwright/ receive E2E patterns and discovery workflow via scoped CLAUDE.md
  4. A PR targeting staging with a build failure is blocked by CI before merge
**Plans**: 3 plans
- [ ] 13-01-PLAN.md -- Scoped CLAUDE.md files for plugins and E2E tests
- [ ] 13-02-PLAN.md -- Vitest skill for plugin step test generation
- [ ] 13-03-PLAN.md -- CI build check verification

### Phase 14: Agent Team
**Goal**: Five named agents with defined capabilities exist and the Blueprint pipeline stage contract is specified
**Depends on**: Phase 13
**Requirements**: AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05, PIPE-01
**Success Criteria** (what must be TRUE):
  1. Five agent files exist in .claude/agents/ with model assignments (Opus for Orchestrator, Sonnet for workers) and clearly scoped responsibilities
  2. Each agent file defines what that agent can and cannot do (read-only vs read-write, escalation conditions)
  3. The Blueprint pipeline stages (DECOMPOSE -> RESEARCH -> IMPLEMENT -> VERIFY -> PR) are specified with input/output contracts
  4. Orchestrator agent file describes how it coordinates the other four agents through pipeline stages
**Plans**: 2 plans
- [ ] 14-01-PLAN.md -- Orchestrator agent + Blueprint pipeline specification (AGENT-01, PIPE-01)
- [ ] 14-02-PLAN.md -- Worker agents: Builder, Verifier, Researcher, Debugger (AGENT-02, AGENT-03, AGENT-04, AGENT-05)

### Phase 15: Pipeline Commands
**Goal**: Three slash commands invoke the agent pipeline end-to-end for protocol, plugin, and feature development
**Depends on**: Phase 14
**Requirements**: PIPE-02, PIPE-03, PIPE-04
**Success Criteria** (what must be TRUE):
  1. Running /add-protocol with a protocol name produces a complete protocol definition that passes lint, type-check, and tests via the agent pipeline
  2. Running /add-plugin with a plugin name produces a complete plugin in keeperhub/plugins/ that passes lint, type-check, and tests via the agent pipeline
  3. Running /add-feature with a feature description produces an implemented, tested, PR-ready feature via the agent pipeline
  4. All three commands invoke agents in DECOMPOSE -> RESEARCH -> IMPLEMENT -> VERIFY -> PR order
**Plans**: TBD

### Phase 16: Safeguards
**Goal**: The pipeline enforces tiered autonomy -- blocking high-risk changes, limiting retries, and requiring Verifier approval before any PR
**Depends on**: Phase 15
**Requirements**: SAFE-01, SAFE-02, SAFE-03, SAFE-04
**Success Criteria** (what must be TRUE):
  1. Pipeline commands targeting schema migrations, security code, or Web3 transactions halt and request human review before creating a PR
  2. After 2 consecutive CI failures, the pipeline escalates to the user instead of retrying automatically
  3. pnpm build runs and must pass before any PR is created, catching "use step" bundler violations
  4. No PR is created unless the Verifier agent has explicitly approved the changes in that pipeline run
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 13. Foundation | 3/3 | Complete    | 2026-03-01 | - |
| 14. Agent Team | 2/2 | Complete    | 2026-03-01 | - |
| 15. Pipeline Commands | 3/3 | Complete   | 2026-03-01 | - |
| 16. Safeguards | v1.4 | 0/TBD | Not started | - |
