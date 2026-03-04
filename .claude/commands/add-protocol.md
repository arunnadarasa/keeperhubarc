---
description: Add a new protocol plugin to KeeperHub via the agent pipeline
argument-hint: <protocol-name-or-spec-file>
---

<objective>
Add a new KeeperHub protocol plugin. $ARGUMENTS is either:
- A protocol name (e.g., "Aave", "Uniswap V3") -- pipeline will gather contract details
- A file path ending in `.md` (e.g., `specs/my-protocol.md`) -- pipeline reads spec file for details
- Empty -- pipeline will ask user what protocol to add

This command invokes the Orchestrator agent which runs the full Blueprint pipeline: DECOMPOSE -> RESEARCH -> IMPLEMENT -> VERIFY -> PR. The pipeline produces a complete, lint-clean, type-safe protocol definition in `keeperhub/protocols/` with tests and documentation.
</objective>

<context>
Domain knowledge: @.claude/agents/protocol-domain.md
Example protocol: @keeperhub/protocols/weth.ts
Protocol registry: @keeperhub/lib/protocol-registry.ts
Project conventions: @CLAUDE.md
Blueprint pipeline: @.claude/agents/blueprint-pipeline.md
Existing protocols: !`ls keeperhub/protocols/`
</context>

<process>
Spawn the Orchestrator agent with the following task description:

```
Protocol Task: Add protocol "$ARGUMENTS" to KeeperHub

Domain Reference: .claude/agents/protocol-domain.md

Task Type: Protocol plugin creation (Tier 1 -- follows existing pattern)

Required artifacts:
- keeperhub/protocols/{slug}.ts -- protocol definition using defineProtocol()
- tests/unit/protocol-{slug}.test.ts -- Vitest unit tests
- docs/plugins/{slug}.md -- documentation page
- public/protocols/{slug}.png -- icon (if user provides one)

Required modifications:
- docs/plugins/_meta.ts -- add nav entry
- docs/plugins/overview.md -- add to protocols table
- (auto-generated) keeperhub/protocols/index.ts
- (auto-generated) lib/types/integration.ts

Research questions for the Researcher agent:
- What contracts does this protocol have and on which chains?
- Does any existing protocol definition serve as a closer pattern than WETH?
- Does the slug "{slug}" already exist in lib/types/integration.ts or keeperhub/protocols/?
- Does the protocol have Sepolia testnet deployments? If so, include addresses for chain "11155111".

Success criteria:
- keeperhub/protocols/{slug}.ts imports without throwing (defineProtocol validation passes)
- pnpm discover-plugins runs without errors and registers the protocol
- pnpm check passes with zero lint errors
- pnpm type-check passes with zero TypeScript errors
- Vitest unit tests pass
- Documentation page exists with actions table and per-action sections
```

The Orchestrator handles: gathering protocol details from user or spec file, decomposing subtasks, delegating to Researcher/Builder/Verifier agents, and creating the PR.
</process>

<success_criteria>
- Orchestrator pipeline completes end-to-end
- Protocol definition at keeperhub/protocols/{slug}.ts passes defineProtocol() validation
- All checks pass: pnpm check, pnpm type-check, vitest unit tests
- PR created targeting staging branch with conventional commit format
- Verifier agent explicitly approved before PR creation (SAFE-04 gate)
- Pipeline safeguards enforced: risk tier classified (SAFE-01), iteration limits tracked (SAFE-02), build verified (SAFE-03)
</success_criteria>
