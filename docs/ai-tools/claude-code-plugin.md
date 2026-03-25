---
title: "Claude Code Plugin"
description: "Build and manage KeeperHub workflows directly from Claude Code with skills, commands, and MCP tools."
---

# Claude Code Plugin

[GitHub](https://github.com/KeeperHub/claude-plugins/tree/main/plugins/keeperhub)

The KeeperHub plugin for Claude Code lets you create workflows, browse templates, debug executions, and explore plugins without leaving your terminal.

## Installation

There are two ways to connect Claude Code to KeeperHub:

### Option A: Remote MCP (no install needed)

Connect directly to KeeperHub's hosted MCP server. No CLI or plugin installation required.

```bash
claude mcp add --transport http keeperhub https://app.keeperhub.com/mcp
```

Then run `/mcp` inside Claude Code to authorize via browser. That's it.

### Option B: Plugin with local CLI

Install the plugin for skills, slash commands, and a local MCP server.

**1. Install the `kh` CLI**

```bash
brew install keeperhub/tap/kh
```

See [CLI installation options](https://github.com/KeeperHub/cli#install) for other platforms.

**2. Install the plugin**

```bash
/plugin marketplace add KeeperHub/claude-plugins
/plugin install keeperhub@keeperhub-plugins
/keeperhub:login
```

Restart Claude Code after setup for MCP tools to become available.

### Requirements

- KeeperHub account at [app.keeperhub.com](https://app.keeperhub.com)
- Option A: just a browser (for OAuth)
- Option B: the `kh` CLI ([install instructions](https://github.com/KeeperHub/cli#install))

## Commands

### `/keeperhub:login`

One-time setup. Checks the `kh` CLI is installed and runs `kh auth login` to authenticate via browser. Credentials are stored in the OS keyring by the CLI.

For headless/CI environments, set the `KH_API_KEY` environment variable with an organization API key (`kh_` prefix).

### `/keeperhub:status`

Check authentication status, CLI version, and MCP server readiness.

```
KeeperHub Status
----------------
kh CLI:       Installed (v1.2.0)
Auth:         Authenticated as simon@keeperhub.com
Organization: KeeperHub
Auth method:  browser
MCP server:   Ready (kh serve --mcp)
```

## Skills

Skills activate automatically based on what you ask Claude to do. No slash commands needed; just describe what you want.

### workflow-builder

**Activates when you say:** "create a workflow", "monitor my wallet", "set up automation", "when X happens do Y", "alert me when..."

Walks through building a workflow step by step:
1. Identifies the trigger (what starts it)
2. Discovers available actions via `list_action_schemas`
3. Adds actions one at a time with your input
4. Creates the workflow and offers to test it

**Example prompts:**
- "Create a workflow that checks my vault health every 15 minutes and sends a Telegram alert if collateral drops below 150%"
- "Monitor 0xABC... for large transfers and notify Discord"
- "Set up a weekly reward distribution to stakers"

### template-browser

**Activates when you say:** "show me templates", "find a workflow for...", "deploy a template", "what pre-built workflows exist"

Searches the template library, shows details, and deploys templates to your account with optional customization.

### execution-monitor

**Activates when you say:** "why did my workflow fail", "check execution status", "run my workflow", "show logs"

Triggers workflows, polls for completion, and debugs failures by analyzing execution logs. Identifies the failing step, explains the error, and offers to fix the workflow.

### plugin-explorer

**Activates when you say:** "what plugins are available", "how do I use web3", "show integrations", "what actions can I use"

Lists available plugins and their actions, shows configured integrations, and validates plugin configurations.

## Configuration

Authentication is handled by the `kh` CLI, which stores credentials in the OS keyring (from `kh auth login`) or reads the `KH_API_KEY` environment variable.

| Variable | Description |
|----------|-------------|
| `KH_API_KEY` | API key for headless/CI environments (`kh_` prefix, organization-scoped) |

The MCP server runs via `kh serve --mcp` and is configured automatically by the plugin.

## Security

- Browser-based OAuth stores tokens in the OS keyring (not on disk)
- API keys (`KH_API_KEY`) are only used in headless environments
- All API communication is over HTTPS
