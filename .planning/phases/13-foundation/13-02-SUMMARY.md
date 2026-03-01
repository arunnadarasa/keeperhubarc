---
phase: 13-foundation
plan: 02
status: complete
started: 2026-03-01
completed: 2026-03-01
requirements-completed: [FOUND-01]
---

## Summary

Created a Claude Code skill that generates Vitest unit tests for KeeperHub plugin step files.

## What Was Built

**.claude/skills/vitest-plugin/SKILL.md** -- A skill file with:
- YAML frontmatter matching trigger phrases ("write tests for", "test this step", "generate tests", "add unit tests")
- 5-step workflow: Identify step file, Analyze dependencies, Generate test file, Run tests, Fix failures
- Standard mock boilerplate template for server-only, step-handler, plugin-metrics, logging, db, db/schema, drizzle-orm
- Dependency-specific mock patterns for: @/lib/rpc, ethers, @/lib/credential-fetcher, @/lib/explorer, @/lib/utils
- Test helper functions (makeInput, runStep, expectSuccess, expectFailure)
- Test group structure (validation, execution, error handling)
- Rules for correct mock ordering and lint compliance
- Reference files list for pattern lookup

## Key Decisions

- Used the commit-message skill as structural reference for YAML frontmatter format
- Included the full mock boilerplate inline rather than referencing batch-read-contract.test.ts -- agents need the template immediately available, not a file to read
- Added both `vi.fn()` spy patterns and plain mock object patterns since step tests use both
- Kept the db mock flexible with both `select().from().where().limit()` chain and `query.explorerConfigs.findFirst()` patterns since step files use both Drizzle APIs

## Key Files

### Created
- `.claude/skills/vitest-plugin/SKILL.md`

## Commits

1. `feat(13-02): add Vitest plugin step test generation skill`

## Self-Check: PASSED
- Skill file exists at .claude/skills/vitest-plugin/SKILL.md
- Contains valid YAML frontmatter with name, description, version
- Contains server-only, withStepLogging, withPluginMetrics mocks
- Contains vi.mock patterns
- References tests/unit/ as output location
- References batch-read-contract.test.ts as canonical example
- No emojis in the file
