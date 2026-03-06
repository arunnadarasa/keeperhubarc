---
title: "Authentication"
description: "KeeperHub API authentication methods - session auth and API keys."
---

# Authentication

The KeeperHub API supports two authentication methods.

## Session Authentication

For browser-based applications, authentication is handled via Better Auth session cookies. Users authenticate through the standard login flow at `app.keeperhub.com`.

## API Key Authentication

For programmatic access, use API keys in the `Authorization` header:

```bash
curl -H "Authorization: Bearer kh_your_api_key" \
  https://app.keeperhub.com/api/workflows
```

### Key Types

KeeperHub has two types of API keys:

| Prefix | Scope | Created in | Used for |
|--------|-------|------------|----------|
| `kh_` | Organization | Settings > API Keys > Organisation | REST API, MCP server, Claude Code plugin |
| `wfb_` | User | Settings > API Keys | Webhook triggers |

### Creating API Keys

1. Navigate to Settings in the KeeperHub dashboard
2. Select "API Keys"
3. For organization keys (`kh_`), switch to the Organisation tab
4. Click "Create New Key"
5. Copy the key immediately -- it will only be shown once

### Key Security

- Keys are hashed with SHA256 before storage
- Only the key prefix is stored for identification
- Revoke keys immediately if compromised

## Webhook Authentication

For webhook triggers, use a user-scoped key (`wfb_`) with the workflow-specific webhook URL:

```bash
POST /api/workflows/{workflowId}/webhook
Authorization: Bearer wfb_your_api_key
```
