---
phase: 15-pipeline-commands
plan: 02
status: complete
started: 2026-03-01T00:00:00Z
completed: 2026-03-01T00:00:00Z
commits:
  - hash: a8460f0e5
    message: "feat(15-02): extract plugin domain knowledge and create /add-plugin command"
---

## Summary

Extracted all plugin-specific domain knowledge from the 602-line `/develop-plugin` command into a standalone reference document (`.claude/agents/plugin-domain.md`) and created a new `/add-plugin` command as an 81-line thin Orchestrator wrapper.

## What Changed

### Created
- `.claude/agents/plugin-domain.md` -- Plugin domain reference with directory structure, complete file templates (index.ts, step files for credential-based and system variants, credentials.ts, test.ts, icon.tsx), config field types, naming conventions, plugin variants, bundler constraints, registration steps, critical rules, and documentation structure
- `.claude/commands/add-plugin.md` -- New 81-line thin Orchestrator wrapper that replaces `/develop-plugin`. Named `add-plugin` per PIPE-03 requirement for consistent `/add-*` naming pattern.

## Key Decisions
- Created as a new file (`add-plugin.md`) rather than modifying `develop-plugin.md` -- the old command remains for reference but is superseded
- Bundler constraints prominently documented since violations break production builds
- Both credential-based and system plugin step templates included so Builder agents have patterns for either variant

## Self-Check: PASSED

## key-files
### created
- .claude/agents/plugin-domain.md
- .claude/commands/add-plugin.md
