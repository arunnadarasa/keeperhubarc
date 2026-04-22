---
title: "Agentic Wallets"
description: "Install an x402/MPP wallet in your AI agent to pay for KeeperHub workflows or any x402/MPP service. Covers the first-party KeeperHub agentic wallet plus the main third-party options."
---

# Agentic Wallets

KeeperHub paid workflows settle via [x402](https://docs.cdp.coinbase.com/x402) on Base USDC or MPP on Tempo USDC.e: each call carries a USDC payment, and the server returns a result only after the payment is verified. To call a paid workflow, your agent needs an x402/MPP wallet.

This page covers the first-party **KeeperHub agentic wallet** (skill + npm package, server-side Turnkey custody) and the main third-party alternatives. Every wallet listed works with KeeperHub and with any other x402/MPP-compliant service.

## KeeperHub agentic wallet

A skill + npm package from KeeperHub. Custody is server-side in a per-wallet Turnkey sub-organisation, so no private key lands on disk. A `PreToolUse` hook gates every signing call against a three-tier (auto / ask / block) policy sourced from `~/.keeperhub/safety.json`.

### Install

**Recommended -- one command, fully wired up:**

```bash
npx @keeperhub/wallet skill install
```

This writes the skill file into every detected agent skill directory (Claude Code, Cursor, Cline, Windsurf, OpenCode) **and** registers the `keeperhub-wallet-hook` `PreToolUse` safety hook in `~/.claude/settings.json`. Re-running is safe: the installer is idempotent and preserves any foreign keys already in `settings.json`. For agents without auto-registration support a copy-paste notice is printed.

**Alternative -- `npx skills add` (skill file only):**

```bash
npx skills add keeperhub/agentic-wallet-skills
```

This installs the skill file via the vercel-labs/skills convention but **does not register the `PreToolUse` safety hook**. Without the hook, signing calls are not gated by your auto/ask/block thresholds. After running `skills add` you MUST also run `npx @keeperhub/wallet skill install` to activate the safety hook. The combination is safe: `skill install` is idempotent and will not duplicate the skill file written by `skills add`.

### First payment

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

If `response.status === 402`, `paymentSigner.pay()` detects the challenge (x402 on Base USDC or MPP on Tempo USDC.e), signs through the server-side proxy, and retries. If both challenge types are offered it submits one MPP credential (cheaper, near-instant Tempo settlement).

### Safety hooks

Every wallet signing call is gated by a `PreToolUse` hook that reads thresholds from `~/.keeperhub/safety.json` (never from the transaction payload):

| Tier  | Behaviour                                                                 |
|-------|---------------------------------------------------------------------------|
| auto  | Amount at or below `auto_approve_max_usd` signs without prompting.        |
| ask   | Amount above `auto_approve_max_usd` and at or below `block_threshold_usd` returns `{decision: "ask"}` so Claude Code surfaces an inline prompt in the agent chat. |
| block | Amount above `block_threshold_usd`, or a contract not in `allowlisted_contracts`, is denied without calling `/sign`. |

The hook reads only the payment-challenge fields `amount`, `unit`, and the asset contract address from the tool payload. Forged fields like `trust-level hint` or `admin-override` are ignored by design.

### Default safety config

When `~/.keeperhub/safety.json` is absent the hook applies these defaults:

```json
{
  "auto_approve_max_usd": 5,
  "block_threshold_usd": 100,
  "allowlisted_contracts": [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0x20C000000000000000000000B9537D11c60E8b50"
  ]
}
```

The two allowlisted addresses are the only tokens the hook will authorise out of the box:

- `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` -- **Base USDC**. Canonical Circle USDC contract on Base mainnet (chain id 8453). Used by x402 challenges from KeeperHub and any other x402-compliant service.
- `0x20C000000000000000000000B9537D11c60E8b50` -- **Tempo USDC.e**. USDC bridge token on Tempo mainnet (chain id 4217). Used by MPP challenges from KeeperHub paid workflows that settle on Tempo.

Adding other ERC-20 contracts to `allowlisted_contracts` allows your agent to sign against them too -- at your own risk. To verify an address, paste it into [BaseScan](https://basescan.org) (Base) or the Tempo block explorer; the contract page shows the token name, issuer, and verification status.

## Alternatives

### agentcash

`agentcash` is a CLI + skill bundle from [agentcash.dev](https://agentcash.dev). It maintains a local USDC wallet and signs x402 payments on the agent's behalf.

```bash
npx agentcash add https://app.keeperhub.com
```

This walks KeeperHub's `/openapi.json`, generates a `keeperhub` skill file, and symlinks it into every detected agent skill directory. After install, agents can call `search_workflows` and `call_workflow` as first-class tools; payment is routed through the agentcash wallet automatically.

Supported agents (17 at time of writing): Claude Code, Cursor, Cline, Windsurf, Continue, Roo Code, Kilo Code, Goose, Trae, Junie, Crush, Kiro CLI, Qwen Code, OpenHands, Gemini CLI, Codex, GitHub Copilot.

> **Testing only. Do not custody real funds.**
> agentcash stores the wallet key as an **unencrypted plaintext file** at `~/.agentcash/wallet.json`. There is no passphrase, no keychain integration, and no seed-phrase backup: if the file is deleted, lost, or read by any process running as your user, the funds are gone or stolen. This is appropriate for development and automation experiments with small balances (a few dollars of USDC for test calls); it is not a production wallet.
>
> KeeperHub does not operate agentcash and is not responsible for funds stored in an agentcash wallet. Use it at your own risk and do not top it up beyond what you are willing to lose.

### Coinbase agentic wallet skills

Coinbase publishes a bundle of 9 general-purpose x402 skills that work with any x402-compliant service, KeeperHub included:

```bash
npx skills add coinbase/agentic-wallet-skills
```

This installs skills including `authenticate-wallet`, `fund`, `pay-for-service`, `search-for-service`, `send-usdc`, `trade`, `query-onchain-data`, and `x402`. The wallet is managed through Coinbase Developer Platform; payment flows route through the CDP infrastructure.

Full documentation and security risk ratings: https://skills.sh/coinbase/agentic-wallet-skills

## Comparison

| Feature                 | KeeperHub Agentic Wallet                               | agentcash                                           | Coinbase agentic-wallet-skills                                     |
|-------------------------|--------------------------------------------------------|-----------------------------------------------------|--------------------------------------------------------------------|
| Key custody             | Server-side Turnkey enclave; agent holds HMAC secret   | Plaintext JSON on disk (`~/.agentcash/wallet.json`) | Coinbase Developer Platform (CDP) managed or self-custody variants |
| Private key on disk     | Never                                                  | Yes (unencrypted)                                   | Depends on variant                                                 |
| Payment protocols       | x402 (Base USDC) + MPP (Tempo USDC.e)                  | x402                                                | x402 (Coinbase ecosystem)                                          |
| PreToolUse safety hook  | Three-tier auto/ask/block built-in                     | Not bundled                                         | Not bundled                                                        |
| Onboarding              | Zero-registration, under 60 seconds                    | Zero-registration                                   | Requires CDP account for the managed variant                       |
| Install                 | `npx @keeperhub/wallet skill install`                  | `npx agentcash add https://app.keeperhub.com`       | `npx skills add coinbase/agentic-wallet-skills`                    |

## Choosing a wallet

All three wallets call any x402-compliant service, KeeperHub included. The choice comes down to custody and ecosystem fit rather than anything KeeperHub-specific.

The KeeperHub agentic wallet is a managed service: KeeperHub runs the Turnkey sub-organisation and proxies signing. You trust KeeperHub to honor the policy-engine limits and the `PreToolUse` hook decision. In return you get no-plaintext-key storage, a three-tier safety hook out of the box, and zero-registration onboarding.

agentcash is fully self-custodial, with plaintext key material at rest. It fits development and automation experiments with small balances; it is not a production wallet for funds you care about.

Coinbase agentic wallet skills assume the CDP ecosystem for the managed variant. A good fit if you already run on CDP; otherwise it introduces Coinbase platform lock-in.

Nothing stops you installing multiple wallets side by side; they do not conflict.

## What KeeperHub exposes to the agent

Whichever wallet you install, the agent calls KeeperHub through two meta-tools (described in its OpenAPI at `/openapi.json`):

- `search_workflows` -- find workflows by category, tag, or free text. Returns slug, description, inputSchema, and price for each match.
- `call_workflow` -- execute a listed workflow by slug. For read workflows the call executes and returns the result; for write workflows it returns unsigned calldata `{to, data, value}` for the caller to submit.

The meta-tool pattern keeps the agent's tool list small regardless of how many workflows are listed: the agent discovers available workflows at runtime instead of registering one tool per workflow.

## Paying for calls

Paid workflows settle in USDC on Base (via x402) or USDC.e on Tempo (via MPP). Most workflows cost under `$0.05` per call. See [Paid Workflows](/workflows/paid-workflows) for the creator-side view of the same settlement.

## Known limitations

- Signing is supported on Base and Tempo (chain 4217) today. Solana, Arbitrum, Optimism and other chains are not yet supported.
- Ask-tier approvals are surfaced inline via the agent's permission prompt.

## Links

- npm: [`@keeperhub/wallet`](https://www.npmjs.com/package/@keeperhub/wallet)
- Skills registry: [`keeperhub/agentic-wallet-skills`](https://skills.sh/keeperhub/agentic-wallet-skills)
- Source: [`packages/wallet`](https://github.com/KeeperHub/keeperhub/tree/main/packages/wallet) in the KeeperHub monorepo.
