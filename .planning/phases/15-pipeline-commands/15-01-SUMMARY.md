---
phase: 15-pipeline-commands
plan: 01
status: complete
started: 2026-03-01T00:00:00Z
completed: 2026-03-01T00:00:00Z
commits:
  - hash: c9ca2814e
    message: "feat(15-01): extract protocol domain knowledge and rewrite /add-protocol as Orchestrator wrapper"
---

## Summary

Extracted all protocol-specific domain knowledge from the 658-line `/add-protocol` command into a standalone reference document (`.claude/agents/protocol-domain.md`) and rewrote the command as a 67-line thin Orchestrator wrapper.

## What Changed

### Created
- `.claude/agents/protocol-domain.md` -- Protocol domain reference with defineProtocol API shape, validation rules, chain IDs, ABI handling, user-specified addresses, icon handling, output fields, registration steps, WETH reference, known issues, documentation structure, and test structure

### Modified
- `.claude/commands/add-protocol.md` -- Rewritten from 658 lines to 67 lines. Removed all ad-hoc pipeline logic (GATHER/ANALYZE/PLAN/DEVELOP/TEST/FIX phases, protocol-analyst/protocol-developer/protocol-tester/protocol-fixer subagents). Now spawns the Orchestrator with a structured task description referencing `protocol-domain.md`.

## Key Decisions
- Protocol domain knowledge is a reference document (no agent frontmatter) so any agent can read it
- WETH reference included verbatim as the canonical pattern for Builder agents
- Known issues section preserved to prevent agents from breaking critical runtime behavior

## Self-Check: PASSED

## key-files
### created
- .claude/agents/protocol-domain.md

### modified
- .claude/commands/add-protocol.md
