---
title: "Quickstart"
description: "KeeperHub CLI Quickstart"
---

# Quickstart

## Install

**Homebrew (macOS/Linux):**
```
brew install keeperhub/tap/kh
```

**Go install:**
```
go install github.com/keeperhub/cli/cmd/kh@latest
```

**Binary download:** Download from [GitHub Releases](https://github.com/keeperhub/cli/releases) and add to your PATH.

## Authenticate

```
kh auth login
```

This opens a browser window to authenticate. Your token is stored in the OS keyring.

To authenticate non-interactively (CI/CD), set `KH_API_KEY` instead.

## Common Commands

**List workflows:**
```
kh workflow list
```

**Run a workflow and wait for completion:**
```
kh workflow run <workflow-id> --wait
```

**Check a run's status:**
```
kh run status <run-id>
```

**View run logs:**
```
kh run logs <run-id>
```

**Execute a contract call:**
```
kh execute contract-call --protocol aave --action supply --args '{"amount":"1000000"}'
```

**List available protocols:**
```
kh protocol list
```

## MCP Server Mode

The CLI can act as an [MCP](https://modelcontextprotocol.io) server, exposing KeeperHub actions as tools to AI assistants.

**Start the MCP server:**
```
kh serve --mcp
```

**Add to Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{ "mcpServers": { "keeperhub": { "command": "kh", "args": ["serve", "--mcp"] } } }
```

Restart Claude Desktop. KeeperHub tools will appear in the tool list.

## Next Steps

- [Concepts](./concepts) -- authentication, output formats, configuration
- [Command reference](./commands/kh) -- full documentation for every command
