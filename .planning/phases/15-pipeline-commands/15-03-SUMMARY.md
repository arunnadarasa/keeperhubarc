---
phase: 15-pipeline-commands
plan: 03
status: complete
started: 2026-03-01T00:00:00Z
completed: 2026-03-01T00:00:00Z
commits:
  - hash: eda682de4
    message: "feat(15-03): create /add-feature general-purpose pipeline command"
---

## Summary

Created `/add-feature` as an 81-line thin Orchestrator wrapper for general-purpose KeeperHub feature development -- the catch-all entry point for anything not covered by `/add-protocol` or `/add-plugin`.

## What Changed

### Created
- `.claude/commands/add-feature.md` -- General-purpose feature command with risk tier classification (Tier 1 full-auto, Tier 2 human-reviewed, Tier 3 HALT), KeeperHub conventions for the Orchestrator, research guidance for the Researcher agent, and success criteria definition.

## Key Decisions
- No separate domain reference document -- general features use CLAUDE.md and codebase discovery via the Researcher agent
- Risk tier examples are concrete: "Schema migrations = Tier 3" gives the Orchestrator clear halt signals
- Includes the "use step" bundler constraint warning since any feature could touch step files

## Self-Check: PASSED

## key-files
### created
- .claude/commands/add-feature.md
