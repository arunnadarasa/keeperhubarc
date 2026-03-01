# Requirements: KeeperHub

**Defined:** 2026-03-01
**Core Value:** Users can build and deploy Web3 automation workflows through a visual builder without writing code.

## v1.4 Requirements

Requirements for the Agent Team milestone. Each maps to roadmap phases.

### Foundation

- [ ] **FOUND-01**: Vitest unit test writing skill exists and can generate tests for KeeperHub plugin step files
- [ ] **FOUND-02**: Scoped CLAUDE.md in keeperhub/plugins/ provides plugin-specific coding standards and patterns to agents
- [ ] **FOUND-03**: Scoped CLAUDE.md in tests/e2e/playwright/ provides E2E test writing patterns and discovery workflow to agents
- [ ] **FOUND-04**: pnpm build runs as a blocking CI check on PRs targeting staging

### Agent Definitions

- [x] **AGENT-01**: Orchestrator agent (Opus) decomposes tasks, coordinates other agents, and manages the Blueprint pipeline
- [x] **AGENT-02**: Builder agent (Sonnet) implements code changes that pass lint, type-check, and build
- [x] **AGENT-03**: Verifier agent (Sonnet) performs read-only quality review, runs tests, and gates PR creation
- [x] **AGENT-04**: Researcher agent (Sonnet) explores codebase, discovers patterns, and gathers implementation context
- [x] **AGENT-05**: Debugger agent (Sonnet) investigates failures using scientific method with checkpoint management

### Pipeline

- [x] **PIPE-01**: Blueprint pipeline executes deterministic stages: DECOMPOSE -> RESEARCH -> IMPLEMENT -> VERIFY -> PR
- [ ] **PIPE-02**: /add-protocol slash command uses the agent pipeline to create protocol definitions end-to-end
- [ ] **PIPE-03**: /add-plugin slash command (renamed from /develop-plugin) uses the agent pipeline to create plugins end-to-end
- [ ] **PIPE-04**: /add-feature slash command uses the agent pipeline for general KeeperHub feature development

### Safeguards

- [x] **SAFE-01**: Human review gate blocks PR creation for high-risk changes (schema migrations, security, Web3 transactions)
- [x] **SAFE-02**: 2-round iteration limit escalates to human after 2 failed CI rounds instead of retrying indefinitely
- [x] **SAFE-03**: Full build verification (pnpm build) runs before PR to catch "use step" bundler violations
- [x] **SAFE-04**: Verifier agent must approve changes before PR creation proceeds

## Future Requirements

### Autonomy Expansion

- **AUTO-01**: Cost monitoring with per-task spending caps
- **AUTO-02**: External progress artifacts for visibility into agent work
- **AUTO-03**: Metrics dashboard tracking agent success rate, iteration count, and cost per task
- **AUTO-04**: Graduated autonomy levels based on task risk classification

### Agent Enhancements

- **ENHANCE-01**: Agent self-improvement from PR review feedback
- **ENHANCE-02**: Cross-agent knowledge sharing via shared memory
- **ENHANCE-03**: Parallel agent execution for independent subtasks

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full 24/7 autonomous operation | Tiered autonomy first; expand based on success metrics |
| Redis-backed rate limiting for agents | In-memory sufficient for initial team size |
| Custom agent UIs or dashboards | CLI-first; visual tooling deferred |
| Agent-to-agent direct communication | Orchestrator mediates all coordination for v1.4 |
| Third-party agent frameworks (LangChain, CrewAI) | Claude Code native agents are simpler and better integrated |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 13 | Pending |
| FOUND-02 | Phase 13 | Pending |
| FOUND-03 | Phase 13 | Pending |
| FOUND-04 | Phase 13 | Pending |
| AGENT-01 | Phase 14 | Complete |
| AGENT-02 | Phase 14 | Complete |
| AGENT-03 | Phase 14 | Complete |
| AGENT-04 | Phase 14 | Complete |
| AGENT-05 | Phase 14 | Complete |
| PIPE-01 | Phase 14 | Complete |
| PIPE-02 | Phase 15 | Pending |
| PIPE-03 | Phase 15 | Pending |
| PIPE-04 | Phase 15 | Pending |
| SAFE-01 | Phase 16 | Complete |
| SAFE-02 | Phase 16 | Complete |
| SAFE-03 | Phase 16 | Complete |
| SAFE-04 | Phase 16 | Complete |

**Coverage:**
- v1.4 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-03-01*
*Last updated: 2026-03-01 after roadmap creation (phases 13-16)*
