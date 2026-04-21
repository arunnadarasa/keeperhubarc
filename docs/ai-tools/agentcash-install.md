---
title: "Install the KeeperHub Skill"
description: "One-command install for Claude Code, Cursor, and 15 other AI agents using agentcash."
---

# Install the KeeperHub Skill

Run KeeperHub workflows from any supported AI agent with a single command:

```bash
npx agentcash add https://app.keeperhub.com
```

This walks KeeperHub's `/openapi.json`, generates a local `keeperhub` skill file, and symlinks it into every agent skill directory it finds on your machine.

## Supported agents

`agentcash add` auto-detects installed agents and installs the skill into each one. Currently supported:

- Claude Code
- Cursor
- Cline
- Windsurf
- Continue
- Roo Code
- Kilo Code
- Goose
- Trae
- Junie
- Crush
- Kiro CLI
- Qwen Code
- OpenHands
- Gemini CLI
- Codex
- GitHub Copilot

Once installed, your agent can tab-complete `/keeperhub` and route to KeeperHub's workflow catalog directly. No API key setup is required for this install path — per-call payments are handled by agentcash's wallet.

## Paying for calls

Paid workflows settle in USDC on Base (via x402) or USDC.e on Tempo (via MPP). The first time your agent calls a paid workflow, agentcash will prompt you to fund a wallet or approve a per-call spending limit. Most workflows cost under `$0.05` per call.

If you already have an agentcash wallet, the balance applies automatically.

## What the skill exposes

After install, the agent has access to two meta-tools:

- `search_workflows` -- find workflows by category, tag, or free text. Returns slug, description, inputSchema, and price for each match.
- `call_workflow` -- execute a listed workflow by slug. For read workflows the call executes and returns the result; for write workflows it returns unsigned calldata `{to, data, value}` for the caller to submit. Use `search_workflows` first to discover available workflows.

This meta-tool pattern keeps the agent's tool list small no matter how many workflows are listed — the agent discovers available workflows at runtime instead of registering one tool per workflow.
