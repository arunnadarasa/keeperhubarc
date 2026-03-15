---
description: Test all actions for a protocol by creating workflows, executing them, and verifying results
argument: protocol-slug (e.g. sky, spark, aave, compound)
---

# Test Protocol: $ARGUMENTS

You are testing all actions for the **$ARGUMENTS** protocol. Follow these steps precisely.

## Step 1: Read Protocol Definition

Read the protocol definition file:
```
keeperhub/protocols/$ARGUMENTS.ts
```

If it does not exist, check for alternate names (e.g., `aave-v3.ts` for `aave`). List what you find:
- Protocol name and slug
- All contracts with their addresses and supported chains
- All actions grouped by type (read vs write)
- Which chains are available (especially check for Sepolia 11155111)

## Step 2: Check for Existing Seed Workflows

Look for pre-built workflow JSON files:
```
scripts/seed/workflows/$ARGUMENTS/
```

If seed workflows exist, use them. If not, you will need to generate them in Step 3.

## Step 3: Generate Seed Workflows (if needed)

If no seed workflows exist, create them:

### Read Actions Workflow
Create `scripts/seed/workflows/$ARGUMENTS/read-actions.json` with:
- One trigger node (Manual)
- One action node per read action in the protocol
- All actions connected from trigger via edges
- Network: use chain "1" (mainnet) as default, or whichever chain has the most contract coverage
- For `account`/`user` address inputs: use the first contract address from the protocol definition (it will return 0 but the call succeeds, proving the action works)
- For `amount`/`assets`/`shares` inputs: use "1000000000000000000" (1e18)
- For `asset` address inputs: use a well-known token address for that chain (e.g., DAI 0x6B175474E89094C44Da98b954EedeAC495271d0F on mainnet)

Node format:
```json
{
  "id": "unique-id",
  "type": "action",
  "position": { "x": 450, "y": "<increment by 150>" },
  "data": {
    "label": "<action label>",
    "description": "<action description>",
    "type": "action",
    "config": {
      "actionType": "<protocol-slug>/<action-slug>",
      "network": "1",
      "...input fields as key-value pairs"
    },
    "status": "idle"
  }
}
```

### Write Actions (optional)
Only if the protocol has Sepolia (11155111) addresses. If not, skip write tests and note it in the report.

## Step 4: Create Test Workflows

Use the kh CLI to create workflows on the local dev server:

```bash
kh wf create --name "Protocol Test: $ARGUMENTS Read Actions" --nodes-file scripts/seed/workflows/$ARGUMENTS/read-actions.json --host http://localhost:3000 --json
```

If `kh wf create` is not available, fall back to curl:
```bash
curl -s -X POST http://localhost:3000/api/workflows/create \
  -H "Content-Type: application/json" \
  -H "x-api-key: <key>" \
  -d @scripts/seed/workflows/$ARGUMENTS/read-actions.json
```

Save the returned workflow ID.

## Step 5: Execute Test Workflows

Execute each workflow:

```bash
kh wf run <workflow-id> --wait --timeout 2m --host http://localhost:3000 --json
```

If `kh wf run` is not available, fall back to curl:
```bash
# Execute
curl -s -X POST http://localhost:3000/api/workflow/<workflow-id>/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: <key>" \
  -d '{}'

# Poll status
curl -s http://localhost:3000/api/workflows/executions/<execution-id>/status \
  -H "x-api-key: <key>"
```

## Step 6: Verify Results

After execution completes, check the results:

```bash
kh r logs <execution-id> --host http://localhost:3000 --json
```

Or via curl to the logs endpoint:
```bash
curl -s http://localhost:3000/api/workflows/executions/<execution-id>/logs \
  -H "x-api-key: <key>"
```

Check that:
- Overall execution status is "success"
- Each node's status is "success"
- No error messages in any node output

## Step 7: Report Results

Print a results table:

| Action | Slug | Status | Duration | Error |
|--------|------|--------|----------|-------|
| Get sUSDS Balance | sky/get-susds-balance | success | 245ms | - |
| ... | ... | ... | ... | ... |

Summary:
- Total actions tested: X
- Passed: Y
- Failed: Z
- Skipped (write, no testnet): W

## Step 8: Cleanup

Delete the test workflows:

```bash
kh wf delete <workflow-id> --yes --host http://localhost:3000
```

Or via curl:
```bash
curl -s -X DELETE http://localhost:3000/api/workflows/<workflow-id> \
  -H "x-api-key: <key>"
```

## Error Handling

- If workflow creation fails: check if the dev server is running (`curl http://localhost:3000/api/health`)
- If execution times out: report which nodes completed and which are stuck
- If individual actions fail: report the specific error from the node logs, continue testing remaining actions
- If kh CLI is not available: use curl fallback for all operations

## Notes

- Always use `--host http://localhost:3000` to target the local dev server
- The protocol slug matches the filename in `keeperhub/protocols/` (without .ts)
- Read actions should always succeed as they only query on-chain state
- Write actions need funded wallets and testnet addresses -- skip if not available
- Save seed workflows for reuse in future test runs
