<overview>
Protocol plugins are "meta-plugins" that define DeFi protocol interactions declaratively.

- Protocols go in `keeperhub/protocols/` as `{slug}.ts` files
- Each file uses `defineProtocol()` from `@/keeperhub/lib/protocol-registry`
- `pnpm discover-plugins` generates the barrel (`keeperhub/protocols/index.ts`) and registers to `lib/types/integration.ts`
- The generic protocol-read/protocol-write step handlers route to the correct contract/function via `_protocolMeta` JSON injected into action config
- If any protocol definition fails validation, the entire import chain fails and the server won't start
- Each protocol slug becomes its own `IntegrationType` entry (e.g., `"weth"`, `"sky"`)
</overview>

<api_shape>
Complete `defineProtocol()` TypeScript shape:

```typescript
import { defineProtocol } from "@/keeperhub/lib/protocol-registry";

export default defineProtocol({
  name: string,           // Display name (e.g., "Sky Protocol")
  slug: string,           // kebab-case (e.g., "sky") -- matches filename without .ts
  description: string,    // One-line description of the protocol
  website?: string,       // Protocol website URL (optional)
  icon?: string,          // Path like "/protocols/sky.png" -- optional, default icon shown if omitted

  contracts: Record<string, {
    label: string,
    addresses: Record<string, string>,  // chainId string -> 0x-prefixed hex address (exactly 42 chars)
    abi?: string,                       // OMIT for auto-fetch (recommended -- see abi_handling)
    userSpecifiedAddress?: boolean,     // When true, runtime address comes from user input (see user_specified_address)
  }>,

  actions: Array<{
    slug: string,           // kebab-case (e.g., "deposit-ssr", "get-balance")
    label: string,          // User-facing label (e.g., "Deposit USDS to Savings")
    description: string,    // What the action does (one sentence)
    type: "read" | "write", // read = view/pure functions, write = state-changing transactions
    contract: string,       // MUST exactly match a key in the contracts object above
    function: string,       // Exact Solidity function name (e.g., "deposit", "balanceOf")
    inputs: Array<{
      name: string,         // Exact Solidity parameter name
      type: string,         // MUST be a valid Solidity type: address, uint256, int256, bytes32, bool, string, bytes, uint8, etc.
      label: string,        // User-facing label shown in workflow builder
      default?: string,     // Default value as string (optional)
      decimals?: boolean | number,  // true = 18 decimals, number = specific decimals
    }>,
    outputs?: Array<{       // REQUIRED for read actions that return values. Omit for write actions.
      name: string,         // Output field name (used as {{NodeId.fieldName}} in templates)
      type: string,         // Solidity return type
      label: string,        // User-facing label
      decimals?: number,    // Decimal places for display
    }>,
  }>,
})
```
</api_shape>

<validation_rules>
Rules enforced by `defineProtocol()` at import time (violations throw at startup):

- Protocol slug must match `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` (kebab-case, start with letter)
- Action slugs must match the same pattern
- Contract addresses must match `/^0x[0-9a-fA-F]{40}$/` (exactly 42 chars, 0x prefix)
- Every `action.contract` value must reference an existing key in the `contracts` object
- At least one contract required
- At least one action required
- No duplicate action slugs
</validation_rules>

<chain_ids>
Supported chains with their numeric string keys:

- "1" -- Ethereum Mainnet
- "8453" -- Base
- "42161" -- Arbitrum One
- "10" -- Optimism
- "11155111" -- Sepolia Testnet
</chain_ids>

<abi_handling>
- OMIT the `abi` field from all contract definitions (recommended)
- `resolveAbi()` auto-fetches from block explorers (Etherscan, BaseScan, Arbiscan) with 24h cache
- Proxy detection is automatic: EIP-1967, EIP-1822, EIP-2535 (Diamond) -- ABI follows the implementation
- Only provide inline `abi` if: contract is unverified on all explorers AND you have the ABI string
- Add a comment noting proxy status: `// Proxy -- ABI auto-resolved via abi-cache`
</abi_handling>

<user_specified_address>
For protocols with user-specific addresses (e.g., Safe multisig):

- Set `userSpecifiedAddress: true` on the contract
- The `addresses` field serves as chain-availability metadata -- use reference addresses (e.g., singleton/implementation addresses) so `collectAllChains()` in the UI correctly shows supported chains
- At build time, `buildConfigFieldsFromAction()` auto-inserts a `contractAddress` template-input field
- At runtime, `protocol-read.ts` and `protocol-write.ts` read `input.contractAddress` instead of looking up from the fixed addresses map
- Reference: `keeperhub/protocols/safe.ts` (canonical example)
</user_specified_address>

<icon_handling>
- Icon is optional -- if omitted, default square protocol icon (`ProtocolIcon`) is displayed
- If URL provided: `curl -sL -o public/protocols/{slug}.png "{url}"`
- If local path provided: `cp {path} public/protocols/{slug}.png`
- Source images must be at least 256x256 for retina display (component renders at 48x48 via Next.js Image)
- Preferred: Trust Wallet assets at `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/{checksumAddress}/logo.png`
- If no icon provided: OMIT the `icon` field entirely from the definition -- do not set it to empty string or null
</icon_handling>

<output_fields>
Auto-added output fields -- do NOT define these manually:

- All actions get: `success` (boolean), `error` (string)
- Write actions get: `transactionHash`, `transactionLink`
- Read actions MUST define `outputs` array if the function returns values
- Output field count and order MUST exactly match the contract function's return values
- Declaring extra outputs causes silent data corruption (values shift or are undefined)
</output_fields>

<registration>
Post-creation steps in this exact order:

1. `pnpm discover-plugins` -- generates barrel and registers to integration types
2. `pnpm check` -- lint check
3. `pnpm type-check` -- TypeScript validation

NEVER manually edit `keeperhub/protocols/index.ts` or `lib/types/integration.ts` -- these are auto-generated.
</registration>

<weth_reference>
Canonical WETH example -- 5 chains, 3 actions (wrap, unwrap, balance-of):

```typescript
import { defineProtocol } from "@/keeperhub/lib/protocol-registry";

export default defineProtocol({
  name: "WETH",
  slug: "weth",
  description: "Wrapped Ether -- wrap ETH to WETH (ERC-20) and unwrap back to ETH",
  website: "https://weth.io",
  icon: "/protocols/weth.png",

  contracts: {
    weth: {
      label: "WETH Contract",
      addresses: {
        // Ethereum Mainnet
        "1": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        // Base
        "8453": "0x4200000000000000000000000000000000000006",
        // Arbitrum One
        "42161": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        // Optimism
        "10": "0x4200000000000000000000000000000000000006",
        // Sepolia Testnet
        "11155111": "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      },
      // ABI omitted -- resolved automatically via abi-cache
    },
  },

  actions: [
    {
      slug: "wrap",
      label: "Wrap ETH",
      description: "Wrap native ETH into WETH (ERC-20). Send ETH value with the transaction.",
      type: "write",
      contract: "weth",
      function: "deposit",
      inputs: [],
    },
    {
      slug: "unwrap",
      label: "Unwrap WETH",
      description: "Unwrap WETH back to native ETH",
      type: "write",
      contract: "weth",
      function: "withdraw",
      inputs: [{ name: "wad", type: "uint256", label: "Amount (wei)" }],
    },
    {
      slug: "balance-of",
      label: "Get Balance",
      description: "Check WETH balance of an address",
      type: "read",
      contract: "weth",
      function: "balanceOf",
      inputs: [{ name: "account", type: "address", label: "Wallet Address" }],
      outputs: [
        {
          name: "balance",
          type: "uint256",
          label: "WETH Balance (wei)",
          decimals: 18,
        },
      ],
    },
  ],
});
```
</weth_reference>

<known_issues>
Critical runtime issues agents must not break:

1. `_protocolMeta` persistence: The protocol detail page must explicitly include `_protocolMeta` in node config -- this is already handled in `protocol-detail.tsx`. Do NOT remove that code.

2. `_actionType` fallback: Protocol step handlers derive metadata from `_actionType` (e.g., `"sky/get-usds-balance"`) via `resolve-protocol-meta.ts`. Do NOT inline that logic back into step files.

3. Cognitive complexity: Protocol step functions are near the Biome limit (15). The metadata resolution was extracted to `resolve-protocol-meta.ts`. Do NOT inline it back.

4. "use step" bundler constraints: Protocol step files have `"use step"` -- NEVER export helper functions from them. Shared logic goes in separate files without `"use step"` (e.g., `resolve-protocol-meta.ts`).

5. Proxy contract ABI resolution: The `hasFunctions` check in `fetchAbiFromExplorer()` is required -- do NOT remove it. Proxy contracts return valid ABI from Etherscan but with only constructor/error/event/fallback entries and no functions.

6. Icon rendering quality: Source images must be at least 256x256 for crisp retina display. Prefer Trust Wallet assets as primary source.
</known_issues>

<documentation_structure>
ALWAYS create documentation when adding a new protocol or feature. This is a required step in the creation workflow.

Format for `docs/plugins/{slug}.md` protocol documentation:

- Frontmatter: title, description
- H1, overview paragraph, supported chains
- Actions table with columns: Action, Type, Credentials, Description
- Per-action H2 sections with Inputs, Outputs, When to use
- Example Workflows section (2-4 practical multi-step workflow examples)
- "Supported Chains" section

Also update:
- `docs/plugins/_meta.ts` -- add protocol entry in alphabetical order
- `docs/plugins/overview.md` -- add row to protocols table
</documentation_structure>

<test_structure>
Format for `tests/unit/protocol-{slug}.test.ts` using Vitest. Tests to include:

- Definition validity (import does not throw)
- Slug format (protocol + all action slugs match pattern)
- Address format (all addresses are 42-char hex)
- Contract references (all action.contract values exist in contracts)
- No duplicate action slugs
- Read action outputs (every read action with return values has outputs defined)
- Action count matches expected
- Registration check (use `getProtocol("{slug}")`)
</test_structure>

<explorer_chain_availability>
Only chains with block explorer configs support ABI auto-fetch. Workflows targeting chains without explorer configs will fail silently at runtime when resolveAbi() cannot fetch the ABI.

Chains WITH explorer configs (safe for seed workflows):
- "1" -- Ethereum Mainnet (Etherscan)
- "8453" -- Base (BaseScan)
- "84532" -- Base Sepolia (BaseScan testnet)
- "11155111" -- Sepolia Testnet (Etherscan Sepolia)

Chains WITHOUT explorer configs (ABI auto-fetch fails):
- "42161" -- Arbitrum One
- "10" -- Optimism

Rules:
- Seed/example workflows MUST only target chains with explorer configs unless the protocol provides an inline `abi` field
- When a protocol supports multiple chains, default to chain "1" (Ethereum Mainnet) for seed workflows
- Update this section when new explorer configs are added to the codebase
</explorer_chain_availability>

<code_node_patterns>
Rules for Code nodes in workflows. Violations cause silent runtime failures.

Template quoting:
- `formatCodeValue()` in `lib/workflow-executor.workflow.ts` (line 664) already wraps string values via `JSON.stringify()` before injecting them into the Code node sandbox
- CORRECT: `const x = {{@nodeId:Label.result}};` -- no manual quotes needed, becomes `const x = "value";`
- WRONG: `const x = "{{@nodeId:Label.result}}";` -- produces `const x = ""value""` which is a JS syntax error
- For numbers: `Number({{@nodeId:Label.result}})` works correctly (becomes `Number("123")`)

Divide-by-zero guards:
- All percentage and ratio calculations in Code nodes MUST guard against divide-by-zero
- Pattern: `const pct = total > 0 ? ((val / total) * 100).toFixed(2) : "0.00";`
- Applies to any expression with division where the denominator comes from a template reference or computed value

Value formatting:
- Use `Intl.NumberFormat` for formatting token amounts and prices (available in Code node VM sandbox via `Intl` global)
- Pattern: `new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)`
- For USD prices: `new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)`
- Prefer `Intl.NumberFormat` over `.toLocaleString()` for consistency and explicit control
</code_node_patterns>

<example_workflow_generation>
The pipeline creates example workflows directly in the local postgres DB using the postgres MCP (`mcp__postgres__execute_sql`). Never use the KeeperHub MCP for this -- workflows stay local only.

Steps:
1. Query `users` and `member` tables to find the local dev user and org:
   `SELECT u.id, m.organization_id FROM users u JOIN member m ON m.user_id = u.id LIMIT 1;`
2. INSERT a project row into `projects` table with `id: "proj-{slug}"` (use ON CONFLICT DO NOTHING to be idempotent)
3. INSERT workflow rows into `workflows` table with correct `user_id`, `organization_id`, `project_id`
4. Use `actionType: "{slug}/{action-slug}"` and include `_protocolMeta` JSON in node configs

What to generate:
- 1 test workflow per read action: manual trigger + single action node, named `[Test - {action-slug}] {description}`
- 8-10 example workflows (or as many as the protocol's actions support) combining multiple actions with Code formatting nodes and notification actions (Discord, SendGrid). Cover as many action combinations as possible.
- Write actions do NOT get test workflows (they require wallets)

Workflow rules:
- All workflows target only chains with explorer configs (see `<explorer_chain_availability>`)
- All Code nodes follow `<code_node_patterns>` rules (no manual quotes around template refs, divide-by-zero guards, Intl formatting)
- Node layout: trigger at x=100, subsequent nodes at x+250 increments, y=250 baseline
- Edge naming: sequential e1, e2, etc.
</example_workflow_generation>
