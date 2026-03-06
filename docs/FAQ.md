---
title: "FAQ"
description: "Frequently asked questions about KeeperHub - getting started, security, workflows, pricing, and more."
---

# Frequently Asked Questions

## Getting Started

### What is KeeperHub?

KeeperHub is a no-code blockchain automation platform. You build visual workflows that monitor onchain state, execute transactions, and send notifications -- without writing code or managing infrastructure. It works with Ethereum, Base, Arbitrum, Polygon, and other EVM-compatible chains.

Common use cases include treasury monitoring, DeFi position management, event-driven alerting, and recurring onchain operations like reward distribution or collateral top-ups.

### How do I get started?

1. Create an account at [app.keeperhub.com](https://app.keeperhub.com)
2. Set up your Para wallet in the Web3 integration settings
3. Fund your wallet with ETH on your target network (start with Sepolia testnet to experiment for free)
4. Build a workflow using the visual builder or the AI assistant
5. Test with a manual trigger before enabling automated scheduling
6. Monitor execution through the run logs

See the [Quick Start Guide](/getting-started/quickstart) for a full walkthrough.

### Do I need to know how to code?

No. The visual builder handles most automation patterns through drag-and-drop nodes for triggers, actions, conditions, and loops. You can also describe what you want in plain English using the AI assistant.

For cases that need custom logic, the [Code Plugin](/plugins/code) lets you write JavaScript in a sandboxed environment. For fully programmatic control, the [REST API](/api) and [MCP server](/ai-tools/mcp-server) let you manage workflows from code or AI agents.

### What blockchains does KeeperHub support?

Ethereum Mainnet, Base, Arbitrum, Polygon, Optimism, and Sepolia (testnet). Gas defaults are applied automatically per chain, with L2 networks using lower gas multipliers since their estimates tend to be more accurate.

Some protocol plugins have chain-specific restrictions -- for example, Ajna is Base-only, and Sky converters are Ethereum-only. Check each plugin's documentation for supported chains.

Non-EVM chains (Solana, Cosmos, Bitcoin L2s) are not currently supported.

### What DeFi protocols does KeeperHub integrate with?

KeeperHub has dedicated plugins for [Aave V3](/plugins/aave-v3) (lending/borrowing), [Morpho](/plugins/morpho) (lending), [Uniswap](/plugins/uniswap) (DEX/liquidity), [CoW Swap](/plugins/cowswap) (MEV-protected orders), [Pendle](/plugins/pendle) (yield tokenization), [Sky](/plugins/sky) (savings/converters), [Ajna](/plugins/ajna) (liquidation), and [Safe](/plugins/safe) (multisig monitoring).

Beyond these, you can interact with any smart contract through the generic [Web3 plugin](/plugins/web3) by providing a contract address -- the ABI is fetched automatically, including for proxy contracts.

---

## Wallet and Funds

### How does the wallet work? Do I need to bring my own?

When you create a KeeperHub account, you can set up a [Para wallet](/wallet-management/para) through the Web3 integration settings. It uses multi-party computation (MPC) -- the private key is split between you and Para so neither party can sign alone, but automated signing is seamless during workflow execution.

Read-only operations (checking balances, reading contracts, monitoring events) do not require any ETH. Write operations (transfers, contract calls) execute through your Para wallet and require ETH for gas on the target network.

### Who controls my funds? Can KeeperHub or Para access my wallet without permission?

Your Para wallet uses MPC where the private key is split into shares held by you and Para -- neither party can sign a transaction alone. This means:

- KeeperHub employees cannot move your funds unilaterally
- Para cannot move your funds unilaterally

The tradeoff: you get convenience and automated signing for workflows, but you are trusting Para's infrastructure to be available for signing operations.

### How do I fund my wallet?

Transfer ETH to your Para wallet address on the network you want to use. Your wallet address is the same across all EVM networks. You can find it in the Wallet tab of your account.

We recommend starting on the Sepolia testnet, where you can get free test ETH from public faucets to experiment without risking real funds.

### Can I export my private key?

Private key export is not currently supported but is planned for a future release. In the meantime, your funds remain accessible through your Para wallet in KeeperHub. We will announce when this feature becomes available.

---

## Security and Trust

### Is KeeperHub safe for production use with real funds?

KeeperHub is designed for production use. The platform provides automatic gas estimation with safety buffers, transaction retry logic, nonce management, and MPC wallet security. Several best practices help minimize risk:

- **Test on Sepolia first** before switching to mainnet
- **Use condition nodes** to validate onchain state before write operations
- **Monitor your wallet balance** and set spending caps
- **Review run logs** regularly to catch unexpected behavior early

### Can KeeperHub employees see my workflows or data?

API keys are hashed with SHA256 before storage -- only the prefix is stored for identification. Wallet private keys are managed by Para, not stored by KeeperHub. Workflow configurations and execution logs are stored in KeeperHub's database as necessary for the platform to function (it needs your workflow configuration to execute it, and stores logs for debugging and analytics).

### What happens to pending transactions during a platform outage?

Transactions that have already been submitted to the blockchain will continue to process regardless of KeeperHub's status -- blockchain transactions are independent of KeeperHub once submitted. Scheduled workflows that would have fired during an outage will not execute until the platform recovers. For time-critical automations like liquidation protection, consider running redundant monitoring through additional channels.

### What data does KeeperHub collect?

KeeperHub stores your account information, workflow configurations (node types, contract addresses, parameters, conditions), and execution logs (inputs, outputs, transaction hashes, gas usage). This data is necessary for the platform to execute your workflows and provide debugging and analytics. API keys are hashed before storage, and wallet private keys are managed by Para, not by KeeperHub.

---

## Workflows and Execution

### What happens if a workflow fails mid-execution?

Blockchain transactions are irreversible. If a workflow fails at step 4, any transactions confirmed in steps 1-3 cannot be rolled back. KeeperHub records the status of every step in the [Runs panel](/keeper-runs/overview) with full error context -- inputs, outputs, transaction hashes, and error messages -- so you can diagnose exactly what happened.

KeeperHub's retry logic re-attempts failed steps with exponential backoff. To mitigate risk: test on Sepolia first, use condition nodes to validate state before write operations, and set up redundant notifications so failures are always reported.

### What are the execution limits?

Known limits:

| Limit | Value |
|-------|-------|
| API rate limit (authenticated) | 100 requests/minute |
| API rate limit (unauthenticated) | 10 requests/minute |
| Direct Execution API | 60 requests/minute per API key |
| Code Plugin timeout | 1-120 seconds (default 60) |
| Batch Read Contract | 5,000 total calls per execution |
| Batch size per RPC request | 1-500 (default 100) |

### How does gas estimation work?

KeeperHub calls `eth_estimateGas` and applies a chain-specific multiplier to prevent failed transactions:

- **Ethereum and Polygon**: 2.0x standard, 2.5x for time-sensitive triggers (events, webhooks)
- **Base and Arbitrum**: 1.5x standard, 2.0x for time-sensitive triggers

You can override the gas limit per action node in the Advanced section. Gas pricing (base fee, priority fee) is handled automatically by KeeperHub's adaptive fee strategy. See [Gas Management](/wallet-management/gas) for details.

### How does the AI workflow builder work?

Click the "Ask AI" input at the bottom of the workflow canvas and describe your automation in plain language -- for example, "Monitor my vault health every 15 minutes and send a Telegram alert if collateral drops below 150%." The AI generates a workflow structure with appropriate triggers, actions, conditions, and node configurations. You review and customize the generated workflow before enabling it.

The AI can also be accessed programmatically through the [MCP server's](/ai-tools/mcp-server) `ai_generate_workflow` tool.

### How do I pass data between workflow steps?

Each node's output is automatically available to downstream nodes through template references using the syntax `{{@nodeId:Label.field}}`. For example, if a "Check Balance" node outputs a balance value, a downstream condition node can reference it as `{{@checkBalance:Check Balance.balance}}`. You can include these references in notification messages, condition expressions, and action parameters. See [Core Concepts](/intro/concepts) for details.

### Does KeeperHub handle token approvals automatically?

No. Approval flows are not automatic. You must add an explicit "Approve ERC20 Token" node before any write operation that requires a token allowance (swaps, lending deposits, etc.). You can also use the "Check ERC20 Allowance" node to verify existing approvals before proceeding.

### Can AI agents use KeeperHub autonomously?

Yes. KeeperHub provides an [MCP server](/ai-tools/mcp-server) with 19 tools that let AI agents create, trigger, execute, and monitor workflows programmatically. This makes KeeperHub an execution layer where autonomous agents can delegate their onchain actions. There is also a Claude Code plugin for developers who want to build workflows from the terminal.

---

## API and Integrations

### Is there an API?

Yes. The REST API at `app.keeperhub.com/api` supports full workflow CRUD, execution, analytics, and integration management. Authenticate with API keys using a Bearer token. See the [API documentation](/api) for all endpoints.

### What notification channels are supported?

[Discord](/plugins/discord) (via webhook URL), [Telegram](/plugins/telegram) (via bot token), [SendGrid email](/plugins/sendgrid), and generic [webhooks](/plugins/webhook). You set up connections once in your account settings and reuse them across all workflows.

### Can I export or version-control my workflows?

You can download any workflow as JSON using the Download button in the toolbar or `GET /api/workflows/{workflowId}/download`. SDK code can be generated via `GET /api/workflows/{workflowId}/code`. You can also duplicate workflows via the API or the Hub. There is no built-in version history or CI/CD integration yet, but the MCP server's `create_workflow` and `update_workflow` tools can be used to build a custom GitOps pipeline.

---

## Account and Organization

### How do teams and organizations work?

You can create organizations with unique slugs, invite team members via email, and share workflows within the organization. All organization members currently have equal permissions -- there are no admin, editor, or viewer roles yet. Role-based access control is planned. As a workaround, create separate organizations for different access needs and limit membership to trusted collaborators.

See [Organizations](/users-teams-orgs/organizations) for details.

### What happens if I lose access to my account?

You can reset your password via a one-time code sent to your email. If you use OAuth (Google, GitHub), you are directed to your provider for recovery.

### What happens if I delete my account?

Account deletion is a soft delete -- your data is preserved but your account is deactivated, and all sessions are invalidated. You can reactivate by contacting an administrator. Before deleting, export your workflow definitions if you want to retain them.

---

## Comparison and Migration

### How does KeeperHub compare to OpenZeppelin Defender, Gelato, or Chainlink Automation?

KeeperHub differentiates with a no-code visual builder (vs YAML/code configuration), AI-assisted workflow generation, and managed MPC wallets (vs self-managed keys). Dedicated [Defender](/guides/defender-migration) and [Gelato](/guides/gelato-migration) migration guides include feature mapping tables and step-by-step transition plans.

OpenZeppelin Defender shuts down July 1, 2026. Gelato Web3 Functions shut down March 31, 2026.

### When should I use a custom keeper bot instead of KeeperHub?

A custom bot may be better when you need sub-second latency for MEV or arbitrage, complex stateful logic that does not fit a DAG of nodes, specific infrastructure requirements (custom RPC nodes, co-located servers), or zero third-party dependencies for security-critical operations.

KeeperHub is the better choice when you want to avoid building and maintaining infrastructure, need to iterate quickly on automation logic without deploying code, want non-technical team members to create and modify automations, or need multi-chain support without managing separate deployments.

### Can I use custom RPC endpoints?

Yes. In Settings, you can set a primary and fallback RPC URL per chain. When set, your custom endpoints are used instead of the platform defaults. Deleting a preference reverts to the default RPC endpoints.
