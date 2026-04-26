# Arc Transfer Debug Learnings

## Scope

This document summarizes the end-to-end debugging outcomes for local KeeperHub direct execution on Arc testnet when called from Krump.

## Environment Snapshot

- KeeperHub local API: `http://localhost:3001/api`
- Krump local app: `http://localhost:3000`
- Arc testnet chain id: `5042002`
- Arc network slug used: `arc-testnet`

## Confirmed Findings

1. Arc chain support is loaded in KeeperHub.
   - `/api/chains` includes chain `5042002`.
   - Arc chain row exists and is enabled in DB.

2. Original token selection failure root cause was confirmed and fixed.
   - Symptom: execution status error `"No token selected"`.
   - Cause: `parseTokenAddress()` only used `tokenAddress` when `tokenConfig` was absent.
   - Krump sends both `tokenAddress` and `tokenConfig` (stringified metadata object).
   - Fix: in `plugins/web3/steps/transfer-token-core.ts`, direct `tokenAddress` now takes precedence whenever present.

3. Arc `supported_tokens` rows are currently not seeded.
   - Query result for `chainId=5042002` returned zero rows.
   - This no longer blocks direct execution when explicit `tokenAddress` is provided (after fix above).

4. Current active blocker after token fix is timeout under nonce-lock contention.
   - Krump timeout logs show abort at exact timeout boundaries:
     - 10s -> abort
     - 30s -> abort
     - 65s -> abort
   - KeeperHub logs show repeated nonce lock acquisition failures and long request durations:
     - `Failed to acquire nonce lock ... after 600 attempts`
     - `POST /api/execute/transfer ... in 30.0s` and `... in 65s`
   - Interpretation: request reaches KeeperHub and proceeds beyond token selection, but waits on nonce lock backlog for this wallet+chain lane.

## Instrumentation Added During Debugging

- KeeperHub transfer route/core:
  - payload parse visibility
  - org context visibility
  - token lookup input/result
  - branch where token validation fails
- Krump KeeperHub client:
  - request start with timeout
  - exception timing (AbortError + elapsed)
  - response completion timing

Debug session log path used:

- `.cursor/debug-aded7a.log`

## Code Changes Made

1. `plugins/web3/steps/transfer-token-core.ts`
   - `parseTokenAddress()` updated so `input.tokenAddress` is used whenever present.

2. `src/keeperhub/client.js` (Krump repo, local only, not in this repo)
   - execute-route default timeout increased from 10s to 30s while preserving env override behavior.
   - additional debug timing logs added.

## Operational Recommendations

1. Short-term
   - Use a higher Krump timeout while nonce backlog exists:
     - `KEEPERHUB_REQUEST_TIMEOUT_MS=90000`

2. Isolation check
   - Test with a fresh org wallet / wallet lane to validate normal latency.

3. Optional data completeness
   - Seed Arc `supported_tokens` for UI selector workflows:
     - `pnpm db:seed-tokens`

## Final Diagnosis

The original Arc error `"No token selected"` came from token resolution logic that ignored direct `tokenAddress` when `tokenConfig` was also present; that logic was fixed. The current observed failures are now dominated by nonce-lock contention and client-side timeout while waiting for KeeperHub execution completion.
