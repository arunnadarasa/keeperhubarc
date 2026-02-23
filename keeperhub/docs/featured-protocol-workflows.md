# How to Feature a Workflow Under a Protocol

Workflows can be featured under a specific protocol. These appear in the "Automate {ProtocolName}" carousel inside the protocol modal on the hub page. Protocol-featured workflows are independent from globally featured workflows -- a workflow can be one, both, or neither.

## Keys

Same keys as global featured workflows. Stored in AWS SSM Parameter Store:

```
# Prod
"/eks/maker-prod/keeperhub-hub/keeperhub-api-key"

# Staging
"/eks/maker-staging/keeperhub-hub/keeperhub-api-key"
```

## Endpoint

POST /api/hub/featured

Auth header: X-Service-Key (not Authorization: Bearer)

## Request Body

| Field                 | Type           | Required | Description                                           |
| --------------------- | -------------- | -------- | ----------------------------------------------------- |
| workflowId            | string         | Yes      | The workflow ID to feature                            |
| featuredProtocol      | string \| null | No       | Protocol slug (e.g. "safe-wallet"). null to remove    |
| featuredProtocolOrder | number         | No       | Sort order (lower = first, ascending)                 |

The `featuredProtocol` value must match the protocol's `slug` from the protocol registry (`keeperhub/lib/protocol-registry.ts`).

Note: When `featuredProtocol` is set, the endpoint does NOT default `featured` to `true`. The two are separate.

## Staging

Staging requires Cloudflare Access headers.

```
curl -X POST https://app-staging.keeperhub.com/api/hub/featured -H "Content-Type: application/json" -H "X-Service-Key: $HUB_SERVICE_API_KEY" -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" -d '{"workflowId": "YOUR_WORKFLOW_ID", "featuredProtocol": "safe-wallet", "featuredProtocolOrder": 1}'
```

## Prod

Prod does not need Cloudflare Access headers.

```
curl -X POST https://app.keeperhub.com/api/hub/featured -H "Content-Type: application/json" -H "X-Service-Key: $HUB_SERVICE_API_KEY" -d '{"workflowId": "YOUR_WORKFLOW_ID", "featuredProtocol": "safe-wallet", "featuredProtocolOrder": 1}'
```

## Remove from Protocol Featured

Set featuredProtocol to null:

```
curl -X POST https://app.keeperhub.com/api/hub/featured -H "Content-Type: application/json" -H "X-Service-Key: $HUB_SERVICE_API_KEY" -d '{"workflowId": "YOUR_WORKFLOW_ID", "featuredProtocol": null}'
```

## Query Protocol Featured Workflows

```
GET /api/workflows/public?featuredProtocol=safe-wallet
```

Returns public workflows with matching `featuredProtocol`, ordered by `featuredProtocolOrder` ascending.

## Success Response

```json
{
  "success": true,
  "workflow": {
    "id": "cnwkksfm6xe6cjye2mvq3",
    "name": "Safe: Monitor Owners",
    "featured": false,
    "featuredOrder": 0,
    "featuredProtocol": "safe-wallet",
    "featuredProtocolOrder": 1
  }
}
```
