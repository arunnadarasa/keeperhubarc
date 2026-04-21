---
title: "KeeperHub Agentic Wallet"
description: "Install the KeeperHub agentic wallet into your AI agent to auto-pay x402 and MPP 402 responses with server-side Turnkey custody and a three-tier safety hook."
---

# KeeperHub Agentic Wallet

The KeeperHub agentic wallet is a skill + npm package that auto-pays any x402 or MPP 402 response. Custody is server-side in Turnkey -- no private keys on disk. A three-tier PreToolUse safety hook gates every signing call against user-configured auto/ask/block thresholds.

## Install

```bash
npx skills add keeperhub/agentic-wallet-skills
```

Or install directly from the npm package:

```bash
npx @keeperhub/wallet skill install
```

Either command writes the skill file into every detected agent skill directory (Claude Code, Cursor, Cline, Windsurf, OpenCode) and registers the `keeperhub-wallet-hook` `PreToolUse` hook in Claude Code automatically. For other agents a copy-paste notice is printed.

## First Payment

Provision a wallet (zero-registration, under 60 seconds):

```bash
npx @keeperhub/wallet add
```

Then, in any Node/TS codebase:

```ts
import { paymentSigner } from "@keeperhub/wallet";

const response = await fetch("https://app.keeperhub.com/w/some-paid-workflow", { method: "POST" });
const paid = await paymentSigner.pay(response);
const result = await paid.json();
```

If `response.status === 402`, `paymentSigner.pay()` detects the challenge (x402 on Base USDC or MPP on Tempo USDC.e), signs through the server-side proxy, and retries. If both challenge types are offered it submits one MPP credential (cheaper + near-instant Tempo settlement).

## Safety hooks

Every wallet signing call is gated by a `PreToolUse` hook that reads thresholds from `~/.keeperhub/safety.json` (never from the transaction payload):

| Tier  | Behaviour                                                                 |
|-------|---------------------------------------------------------------------------|
| auto  | Amount below `auto_approve_max_usd` signs without prompting.              |
| ask   | Amount between `auto_approve_max_usd` and `ask_threshold_usd` surfaces an approval prompt in the agent's chat. |
| block | Amount above `block_threshold_usd`, or a contract not in `allowlisted_contracts`, is denied without calling `/sign`. |

Example `~/.keeperhub/safety.json`:

```json
{
  "auto_approve_max_usd": 5,
  "ask_threshold_usd": 50,
  "block_threshold_usd": 100,
  "allowlisted_contracts": [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0xC0FFEE1234567890ABCDEF0123456789ABCDEF01"
  ]
}
```

The hook reads only `tool_input.amount`, `tool_input.unit`, and `tool_input.to` from the tool payload. Forged fields such as `trust-level hint` or `admin-override` are ignored by design.

## Approval flow

When a signing call falls into the `ask` tier, the hook:

1. Creates an approval request via `POST /api/agentic-wallet/approval-request`.
2. Surfaces the `ask` decision to the agent, which prints the approval URL `https://app.keeperhub.com/approve/{id}` into its chat.
3. The user replies in chat after reviewing (no separate browser page is required -- the URL is optional for inspection).
4. The hook polls `GET /api/agentic-wallet/approval-request/:id` until status is `approved` or `rejected`.
5. On approval the original signing call proceeds; on rejection the hook returns `deny` and `/sign` is never called.

## Compare

| Feature                        | KeeperHub Agentic Wallet                            | agentcash                                                                 | Coinbase agentic-wallet-skills                                   |
|--------------------------------|------------------------------------------------------|---------------------------------------------------------------------------|------------------------------------------------------------------|
| Key custody                    | Server-side Turnkey enclave; agent holds HMAC secret | Plaintext JSON on disk (`~/.agentcash/wallet.json`)                       | Coinbase Developer Platform (CDP) managed or self-custody variants |
| Private key on disk            | Never                                                | Yes (unencrypted)                                                         | Depends on variant                                               |
| Payment protocols              | x402 (Base USDC) + MPP (Tempo USDC.e)                | x402                                                                      | x402 (Coinbase ecosystem)                                        |
| PreToolUse safety hook         | Three-tier auto/ask/block built-in                   | Not bundled                                                               | Not bundled                                                      |
| Onboarding                     | Zero-registration, under 60 seconds, $0.50 test credit | Zero-registration                                                         | Requires CDP account for managed variant                         |
| Installs via                   | `npx skills add keeperhub/agentic-wallet-skills`      | `npx agentcash add https://app.keeperhub.com`                             | `npx skills add coinbase/agentic-wallet-skills`                  |

See the live [x402 Wallets for Agents](/ai-tools/agent-wallets) page for a broader comparison.

### Tradeoffs

- **KeeperHub** is a managed service: KeeperHub runs the Turnkey sub-organisation and proxies signing. You trust KeeperHub to honor the policy-engine limits and the PreToolUse hook decision. In return you get no-plaintext-key storage and the three-tier hook out of the box.
- **agentcash** is fully self-custodial with plaintext key material. Appropriate for development and automation experiments with small balances; not a production wallet for meaningful funds.
- **Coinbase agentic-wallet-skills** depends on the CDP ecosystem for its managed variant. Good fit if you already run on CDP; introduces Coinbase platform lock-in otherwise.

Pick based on your custody preferences and ecosystem fit; nothing prevents installing multiple wallets side by side.

## Known limitations

- Signing supported on Base and Tempo (chain 4217) only in v1.8. Solana, Arbitrum, Optimism, etc. are not yet supported.
- Approval flow uses in-chat `ask` decisions; no email or SMS notification channel yet.
- Anonymous wallets persist indefinitely until linked or explicitly deleted; sub-org cleanup is not automated.
- The $0.50 onboarding credit is one-time per wallet and applies to KeeperHub paid workflows only.

## Links

- npm: [`@keeperhub/wallet`](https://www.npmjs.com/package/@keeperhub/wallet)
- Skills registry: [`keeperhub/agentic-wallet-skills`](https://skills.sh/keeperhub/agentic-wallet-skills)
- Source: [`packages/wallet`](https://github.com/KeeperHub/keeperhub/tree/main/packages/wallet) in the KeeperHub monorepo.
- Comparison of all agent wallets: [x402 Wallets for Agents](/ai-tools/agent-wallets).
