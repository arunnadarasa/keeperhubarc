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
Canonical WETH example -- 4 chains, 3 actions (wrap, unwrap, balance-of):

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
