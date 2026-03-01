---
phase: 13-foundation
plan: 01
status: complete
started: 2026-03-01
completed: 2026-03-01
requirements-completed: [FOUND-02, FOUND-03]
---

## Summary

Created two scoped CLAUDE.md files that serve as agent briefing documents for directory-specific work.

## What Was Built

**keeperhub/plugins/CLAUDE.md** -- Plugin development standards covering:
- Plugin file structure with web3 as canonical example
- "use step" bundler constraints (the most critical rule)
- Core-file pattern for sharing logic between step files
- Step file anatomy with withStepLogging/withPluginMetrics wrappers
- Plugin registration via pnpm discover-plugins
- Unit test patterns with required mock boilerplate
- Biome lint rules specific to plugin code

**tests/e2e/playwright/CLAUDE.md** -- E2E test writing patterns covering:
- Discovery-first workflow (CLI, in-test probing, structured data)
- Key selectors reference table
- Test utilities with import paths
- Test structure patterns (auth setup, describe/beforeEach, waiting, assertions)
- Configuration and run commands

## Key Decisions

- Kept both files concise and actionable rather than exhaustive -- agents get the critical rules without consuming excessive context tokens
- Referenced existing files as canonical examples rather than duplicating code
- Included the mock boilerplate template in the plugins CLAUDE.md since it is the most error-prone part of writing plugin tests

## Key Files

### Created
- `keeperhub/plugins/CLAUDE.md`
- `tests/e2e/playwright/CLAUDE.md`

## Commits

1. `docs(13-01): add scoped CLAUDE.md files for plugins and E2E tests`

## Self-Check: PASSED
- Both files exist at correct paths
- Plugin CLAUDE.md contains "use step" constraints, core-file pattern, server-only, discover-plugins
- E2E CLAUDE.md contains discovery workflow, probe utility, signUpAndVerify, workflow-canvas selector
- Neither file contains emojis
