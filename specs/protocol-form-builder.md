# Spec: ABI-Driven Protocol Form Builder

## Problem

Protocol nodes define actions with typed inputs (`uint256`, `address`, `tuple`, `tuple[]`) but the UI renders every input as a plain text field (`template-input`). This means:

- No input validation. A `uint64` field accepts alphabetic characters.
- No structured editors for tuples or arrays. Users type raw JSON for `tuple[]` fields like CCIP's `tokenAmounts`.
- No type-aware transforms. CCIP's `receiver` field is `bytes` in the ABI but always `abi.encode(address)` for EVM destinations - users must manually pad.
- Protocol definitions are verbose. Each action manually lists every input, output, slug, label, and description even though all of this is derivable from the ABI.
- No integration tests verify that a protocol's ABI + addresses + input encoding actually produce valid on-chain calls.

Meanwhile, the web3 plugin's `abi-function-args` field type already has type-aware rendering: `ArrayInputField` for arrays, `TupleInputField` for tuples, address validation, and recursive nesting. But protocol nodes don't use it because they bypass ABI-driven field generation.

## Goal

A protocol is defined by: addresses, a reduced ABI (the subset of functions to expose), and per-field overrides. Everything else - action list, form fields, validation, integration tests - is derived from the ABI.

## Core principle: the ABI is the spec

The ABI is the single source of truth. The protocol author's job is **curation, not construction**:

1. Get the full ABI (from Etherscan, the project's repo, etc.)
2. Reduce it to the subset of functions you want to expose as workflow nodes
3. Pass that reduced ABI to `defineProtocol` with addresses
4. Forms, validation, type-aware widgets, and integration tests are all derived
5. Add overrides only where the ABI-derived defaults are insufficient

The reduced ABI IS the protocol definition. You never ship dead functions. The protocol file reads as "here's what this protocol does" not "here's everything the contract can do, ignore most of it."

## Design

### Protocol definition shape

Current shape (hand-written actions):

```typescript
defineProtocol({
  name: "Chainlink",
  slug: "chainlink",
  contracts: {
    ccipRouter: {
      abi: CCIP_ROUTER_ABI,
      addresses: { "1": "0x802...", "11155111": "0x0BF..." },
    },
  },
  actions: [
    {
      slug: "ccip-get-fee",
      label: "CCIP Get Fee",
      description: "Quote the LINK fee...",
      type: "read",
      contract: "ccipRouter",
      function: "getFee",
      inputs: [
        { name: "destinationChainSelector", type: "uint64", label: "Destination Chain Selector" },
        { name: "receiver", type: "bytes", label: "Receiver (abi-encoded address)" },
        // ... 4 more manually listed inputs
      ],
      outputs: [{ name: "fee", type: "uint256", label: "Fee Amount (wei)" }],
    },
    // ... 30 more manually defined actions
  ],
});
```

Proposed shape (reduced ABI + overrides):

```typescript
// Step 1: The reduced ABI contains ONLY the functions to expose as nodes.
// Cut from the full IRouterClient ABI - admin functions, owner functions,
// and anything not relevant to workflow users is excluded.
const CCIP_ROUTER_ABI = JSON.stringify([
  {
    type: "function",
    name: "getFee",
    stateMutability: "view",
    inputs: [
      { name: "destinationChainSelector", type: "uint64" },
      { name: "message", type: "tuple", components: [/* receiver, data, tokenAmounts, feeToken, extraArgs */] },
    ],
    outputs: [{ name: "fee", type: "uint256" }],
  },
  {
    type: "function",
    name: "ccipSend",
    stateMutability: "payable",
    inputs: [
      { name: "destinationChainSelector", type: "uint64" },
      { name: "message", type: "tuple", components: [/* same struct */] },
    ],
    outputs: [{ name: "messageId", type: "bytes32" }],
  },
  // No other functions - the ABI subset IS the feature set
]);

// Step 2: Define the protocol. Every function in the ABI becomes a node.
// Overrides are the editorial layer - only where ABI defaults are insufficient.
defineProtocol({
  name: "Chainlink",
  slug: "chainlink",
  contracts: {
    ccipRouter: {
      label: "CCIP Router",
      abi: CCIP_ROUTER_ABI,
      addresses: { "1": "0x802...", "11155111": "0x0BF..." },
      overrides: {
        getFee: {
          label: "CCIP Get Fee",
          description: "Quote the LINK (or native) fee for a CCIP cross-chain message",
          inputs: {
            "message.receiver": {
              inputType: "address",
              label: "Receiver Address",
              encode: (addr: string) => abiCoder.encode(["address"], [addr]),
            },
            "message.data": { default: "0x" },
            "message.extraArgs": { hidden: true, default: EXTRA_ARGS_V1_GAS_LIMIT_ZERO },
          },
        },
        ccipSend: {
          label: "CCIP Send",
          description: "Send a cross-chain message via Chainlink CCIP",
          // Same input overrides - could reference a shared const
        },
      },
    },
  },
});
```

Every function in the reduced ABI becomes a workflow node. No enable/disable flags needed because the ABI only contains what you chose to include.

### What gets derived vs what gets overridden

**Derived from ABI (zero author effort):**

| Property | Source |
|---|---|
| Function list | ABI `type: "function"` entries |
| Input names and Solidity types | ABI `inputs` array |
| Tuple components (recursive) | ABI `components` arrays |
| Output names and types | ABI `outputs` array |
| Read vs write | ABI `stateMutability` (view/pure = read, else = write) |
| Payable flag | ABI `stateMutability === "payable"` |
| Action slug | Kebab-cased function name (e.g. `getFee` -> `get-fee`) |
| Default label | Derived from function name (e.g. `getFee` -> "Get Fee") |
| Input labels | Derived from param name (e.g. `destinationChainSelector` -> "Destination Chain Selector") |
| UI widget type | Solidity type -> widget mapping (see table below) |
| Input validation | Solidity type constraints |

**Override-only (author provides when ABI defaults are insufficient):**

| Property | When needed | Example |
|---|---|---|
| `label` | ABI-derived name is unclear | "Get Fee" -> "CCIP Get Fee" |
| `description` | Needs domain context | Explain what the function does in workflow terms |
| `inputType` | UI type differs from ABI type | `bytes` field shown as `address` input |
| `encode` | Value needs transform before encoding | Address -> abi.encode(address) |
| `default` | Field has a sensible preset | `extraArgs` default, `data` = "0x" |
| `hidden` | Field should not be shown to user | Fixed `extraArgs` for simple transfers |
| `helpTip` | User needs additional guidance | "CCIP chain selector, not chain ID" |
| `options` | Value is a known enum set | Uniswap fee tier: [100, 500, 3000, 10000] |

### Input dot-path addressing

For nested structs, overrides use dot-paths to target specific fields:

```
"message.receiver"           -> the receiver field inside the message tuple
"message.tokenAmounts"       -> the tokenAmounts array inside the message tuple
"message.tokenAmounts.token" -> the token field inside each tokenAmounts element
```

This maps naturally to the recursive `AbiComponent` structure where each component has a `name` and optional `components[]`.

### Solidity type to widget mapping

The form builder derives the UI widget from the Solidity type. No author annotation needed for these:

| Solidity type | Widget | Validation |
|---|---|---|
| `address` | Address input with checksum | 42-char hex, EIP-55 format |
| `uint8`..`uint256` | Numeric text input | Non-negative integer, within type max |
| `int8`..`int256` | Numeric text input | Signed integer, within type range |
| `bool` | Toggle / checkbox | true/false |
| `bytes` | Hex text input | 0x-prefixed hex string |
| `bytes1`..`bytes32` | Hex text input | 0x-prefixed, exact byte length |
| `string` | Text input | Any string |
| `tuple` | Grouped field container (`TupleInputField`) | Validates each component |
| `T[]` (any array) | Array editor (`ArrayInputField`) with + / - buttons | Validates each element |
| `tuple[]` | Array of grouped field containers | Validates each tuple element |

The `inputType` override replaces the widget choice. For example, `type: "bytes"` with `inputType: "address"` renders an address input instead of a hex input.

### Template variable passthrough

Every field supports workflow template variables (`{{@nodeId:Label.field}}`). Validation must allow these through:

```
isValid(value, solidityType):
  if isTemplateVariable(value): return true
  return validateSolidityType(value, solidityType)
```

This matches the existing pattern in `abi-validate-args.ts` (line 36-38).

### The `encode` function

`encode` is an optional function on an input override that transforms the user's value before ABI encoding. It runs in the step handler, after validation, before `reshapeArgsForAbi`.

```typescript
type InputOverride = {
  label?: string;
  helpTip?: string;
  default?: string;
  hidden?: boolean;
  inputType?: string;
  options?: Array<{ label: string; value: string }>;
  encode?: (value: string) => string;
};
```

`encode` is NOT serializable. It lives in the protocol's TypeScript definition file (which is already code, not config). The MCP schemas endpoint and any other serialization layer sees the final derived action (inputs, labels, types) without the encode function.

The step handler applies encode transforms in order:

```
1. Read raw values from workflow config
2. Apply encode transforms where defined
3. reshapeArgsForAbi (pack flat args into tuples)
4. validateArgsForAbi
5. Pass to ethers for ABI encoding
```

### Derivation pipeline

At server startup (protocol registration time):

```
Reduced ABI JSON (only the functions to expose)
  |
  v
Parse all functions -> [{ name, inputs (recursive), outputs, stateMutability }]
  |
  v
For each function (all are enabled - the ABI is the allowlist):
  - Generate slug from function name
  - Generate label from function name
  - Flatten tuple inputs to dot-path list
  - Apply overrides (label, helpTip, default, hidden, inputType, options)
  - Store encode functions in a parallel registry (not in the serializable action)
  - Build ProtocolAction with enriched inputs
  |
  v
Register derived actions in protocol registry (same shape as today)
  |
  v
MCP schemas endpoint serializes as normal (encode functions excluded)
```

The output is a standard `ProtocolDefinition` with `ProtocolAction[]` - the same shape the rest of the system already consumes. The derivation is an internal concern of `defineProtocol`.

### Enriched ProtocolActionInput

The existing type gains optional fields:

```typescript
type ProtocolActionInput = {
  name: string;
  type: string;                         // Solidity type (existing)
  label: string;                        // (existing)
  default?: string;                     // (existing)
  helpTip?: string;                     // (existing)
  decimals?: boolean | number;          // (existing)
  components?: ProtocolActionInput[];   // NEW: for tuple types
  inputType?: string;                   // NEW: UI type override
  hidden?: boolean;                     // NEW: field not shown
  options?: Array<{                     // NEW: enum constraint
    label: string;
    value: string;
  }>;
};
```

`encode` does NOT live on `ProtocolActionInput` (not serializable). It lives in a separate `Map<string, (value: string) => string>` keyed by `${protocolSlug}/${actionSlug}/${inputName}`.

### UI rendering changes

`buildConfigFieldsFromAction` currently emits `template-input` for every input. After this change it emits a richer field type based on the Solidity type:

```typescript
function buildConfigFieldsFromAction(def, action): ActionConfigFieldBase[] {
  const fields = [chainSelectField];

  for (const input of action.inputs) {
    if (input.hidden) continue;

    if (input.type === "tuple" && input.components?.length) {
      // Emit a protocol-tuple field that renders TupleInputField
      fields.push({
        key: input.name,
        label: input.label,
        type: "protocol-struct",
        components: input.components,
        required: true,
      });
    } else if (input.type.endsWith("[]")) {
      // Emit a protocol-array field that renders ArrayInputField
      const baseType = input.type.slice(0, -2);
      fields.push({
        key: input.name,
        label: input.label,
        type: "protocol-array",
        arrayItemType: baseType,
        components: input.components, // for tuple[]
        required: true,
      });
    } else if (input.options) {
      // Emit a select dropdown
      fields.push({
        key: input.name,
        label: input.label,
        type: "select",
        options: input.options,
        required: true,
      });
    } else {
      // Emit template-input with Solidity type metadata for validation
      fields.push({
        key: input.name,
        label: input.label,
        type: "template-input",
        solidityType: input.inputType ?? input.type,
        placeholder: input.default ?? "",
        required: true,
        isAddressField: (input.inputType ?? input.type) === "address",
        helpTip: input.helpTip,
      });
    }
  }

  return fields;
}
```

New field types `protocol-struct` and `protocol-array` are registered via the extension registry (`registerFieldRenderer`) and delegate to the existing `TupleInputField` and `ArrayInputField` components. No changes to those components needed.

### ActionConfigFieldBase additions

```typescript
type ActionConfigFieldBase = {
  // ... existing fields ...
  solidityType?: string;                 // NEW: for client-side validation
  components?: ProtocolActionInput[];    // NEW: for struct/array field types
  arrayItemType?: string;                // NEW: base type for array items
};
```

### Client-side validation

The action config renderer checks `solidityType` on `template-input` fields and shows validation errors:

```typescript
function validateSolidityInput(value: string, solidityType: string): string | null {
  if (isTemplateVariable(value)) return null;
  if (value === "") return null; // empty = not yet filled

  if (solidityType === "address") {
    return isValidAddress(value) ? null : "Invalid address format";
  }
  if (solidityType.startsWith("uint")) {
    const n = BigInt(value);
    if (n < 0n) return "Must be non-negative";
    // optional: check max for type width
    return null;
  }
  if (solidityType.startsWith("int")) {
    BigInt(value); // throws if not numeric
    return null;
  }
  if (solidityType.startsWith("bytes")) {
    return value.startsWith("0x") ? null : "Must be hex (0x-prefixed)";
  }
  return null;
}
```

Validation is advisory (error styling, not blocking). The user can still save a workflow with invalid values - template variables resolve at runtime and might produce valid values.

## Integration test framework

### Purpose

Verify that each protocol action's ABI + contract addresses + input encoding produces a valid on-chain call. Catches: ABI typos, wrong contract addresses, incorrect argument reshaping, broken encode transforms.

### Test structure

For each protocol, a test file `tests/integration/protocol-<slug>.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import protocolDef from "@/protocols/<slug>";
import { reshapeArgsForAbi } from "@/lib/abi-struct-args";
import { getEncodeTransform } from "@/lib/protocol-transforms";

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org";

// Sample inputs per action - the minimum valid values for a real on-chain call
const FIXTURES: Record<string, Record<string, string>> = {
  "ccip-get-fee": {
    destinationChainSelector: "10344971235874465080",
    receiver: "0x1Ec2c78E7531f6B617e42E94918a60356a82a97b", // raw address, encode transform pads it
    data: "0x",
    tokenAmounts: '[{"token":"0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05","amount":"100000000000000000"}]',
    feeToken: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
    extraArgs: "0x97a657c90000000000000000000000000000000000000000000000000000000000000000",
  },
};

describe("Chainlink CCIP on-chain integration", () => {
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);

  for (const [actionSlug, sampleInputs] of Object.entries(FIXTURES)) {
    const action = protocolDef.actions.find(a => a.slug === actionSlug);
    if (!action) continue;

    const contract = protocolDef.contracts[action.contract];
    const chainId = "11155111"; // Sepolia
    const contractAddress = contract.addresses[chainId];
    if (!contractAddress) continue;

    if (action.type === "read") {
      it(`${actionSlug}: eth_call succeeds on Sepolia`, async () => {
        // 1. Build args as the step handler would
        const rawArgs = action.inputs.map(inp => {
          const val = sampleInputs[inp.name] ?? inp.default ?? "";
          const transform = getEncodeTransform(protocolDef.slug, actionSlug, inp.name);
          return transform ? transform(val) : val;
        });

        // 2. Reshape for ABI (flat -> tuples)
        const abi = JSON.parse(contract.abi);
        const functionAbi = abi.find(f => f.name === action.function);
        const args = reshapeArgsForAbi(rawArgs, functionAbi);

        // 3. Encode and call
        const iface = new ethers.Interface(abi);
        const calldata = iface.encodeFunctionData(action.function, args);

        const result = await provider.call({
          to: contractAddress,
          data: calldata,
        });

        // 4. Decode should not throw
        const decoded = iface.decodeFunctionResult(action.function, result);
        expect(decoded).toBeDefined();
      });
    }

    if (action.type === "write") {
      it(`${actionSlug}: estimateGas succeeds on Sepolia`, async () => {
        // Same arg building as above
        const rawArgs = action.inputs.map(inp => {
          const val = sampleInputs[inp.name] ?? inp.default ?? "";
          const transform = getEncodeTransform(protocolDef.slug, actionSlug, inp.name);
          return transform ? transform(val) : val;
        });

        const abi = JSON.parse(contract.abi);
        const functionAbi = abi.find(f => f.name === action.function);
        const args = reshapeArgsForAbi(rawArgs, functionAbi);

        const iface = new ethers.Interface(abi);
        const calldata = iface.encodeFunctionData(action.function, args);

        // estimateGas - will revert if encoding is wrong or contract rejects
        // For write actions that need state (balances, approvals), this may
        // revert with a business logic error - that's OK, it means encoding worked.
        // We catch and check the error is not an encoding/ABI error.
        try {
          const gas = await provider.estimateGas({
            to: contractAddress,
            data: calldata,
            from: "0x1Ec2c78E7531f6B617e42E94918a60356a82a97b",
          });
          expect(gas).toBeGreaterThan(0n);
        } catch (error) {
          // Business logic reverts (insufficient balance, etc.) are OK
          // ABI encoding errors or wrong function selector are NOT OK
          const msg = String(error);
          expect(msg).not.toContain("could not decode");
          expect(msg).not.toContain("invalid function");
          expect(msg).not.toContain("INVALID_ARGUMENT");
        }
      });
    }
  }
});
```

### Test helper: buildProtocolCalldata

Extract the arg-building logic into a reusable helper:

```typescript
// lib/test-utils/protocol-calldata.ts

export function buildProtocolCalldata(
  protocolDef: ProtocolDefinition,
  actionSlug: string,
  sampleInputs: Record<string, string>,
): { to: string; data: string; chainId: string } {
  const action = protocolDef.actions.find(a => a.slug === actionSlug);
  const contract = protocolDef.contracts[action.contract];
  const abi = JSON.parse(contract.abi);
  const functionAbi = abi.find(f => f.name === action.function);

  const rawArgs = action.inputs.map(inp => {
    const val = sampleInputs[inp.name] ?? inp.default ?? "";
    const transform = getEncodeTransform(protocolDef.slug, actionSlug, inp.name);
    return transform ? transform(val) : val;
  });

  const args = reshapeArgsForAbi(rawArgs, functionAbi);
  const iface = new ethers.Interface(abi);
  const calldata = iface.encodeFunctionData(action.function, args);

  // Pick first available chain
  const chainId = Object.keys(contract.addresses)[0];
  return { to: contract.addresses[chainId], data: calldata, chainId };
}
```

### CI considerations

- Integration tests require RPC access. Gate on env var: `SEPOLIA_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, etc.
- Skip test file if no RPC URL configured: `describe.skipIf(!process.env.SEPOLIA_RPC_URL)`
- Cache: `eth_call` results are deterministic for a given block. Pin to a block number for reproducibility.
- Rate limits: use a paid RPC or batch calls. Public RPCs may rate-limit CI.
- Timeout: set per-test timeout to 15s for RPC round-trip.

### Fixture generation

For protocols with many actions (Morpho has 32), manually writing fixtures is tedious. A helper generates minimal valid inputs from the Solidity type:

```typescript
function generateSampleInput(type: string): string {
  if (type === "address") return "0x0000000000000000000000000000000000000001";
  if (type.startsWith("uint")) return "1";
  if (type.startsWith("int")) return "1";
  if (type === "bool") return "true";
  if (type === "bytes") return "0x";
  if (type.startsWith("bytes")) return "0x" + "00".repeat(parseInt(type.slice(5)));
  if (type === "string") return "";
  return "";
}
```

These generate syntactically valid inputs that will encode correctly. They may cause business-logic reverts (e.g. unknown market on Morpho), which is fine - the test validates encoding, not business logic.

For actions that require domain-specific valid inputs (a real market ID, a real pool address), the fixture must be hand-written. The framework supports both: auto-generated defaults with manual overrides per action.

## Migration path

### Phase 1: Enriched ProtocolActionInput (backwards compatible)

Add `components`, `inputType`, `hidden`, `options` to `ProtocolActionInput`. Update `buildConfigFieldsFromAction` to read them. Register `protocol-struct` and `protocol-array` field renderers via extension registry. Add `solidityType` to `ActionConfigFieldBase` for client-side validation.

No protocol definitions need to change. Existing protocols continue to work with `template-input`. Protocols that add `components` get structured editors. Protocols that add `inputType` get type-appropriate widgets.

**Files changed:**
- `lib/protocol-registry.ts` - enrich `ProtocolActionInput` type, update `buildConfigFieldsFromAction`
- `plugins/registry.ts` - add `solidityType`, `components`, `arrayItemType` to `ActionConfigFieldBase`
- `components/workflow/config/action-config-renderer.tsx` - add validation for `solidityType`, register `protocol-struct` / `protocol-array` renderers
- New: `components/workflow/config/protocol-struct-field.tsx` - wrapper around `TupleInputField`
- New: `components/workflow/config/protocol-array-field.tsx` - wrapper around `ArrayInputField`

### Phase 2: Encode transform registry

Add a parallel registry for encode functions keyed by protocol/action/input. Wire into `protocolReadStep` and `protocolWriteStep` before `reshapeArgsForAbi`.

Update CCIP `receiver` field: `inputType: "address"`, with encode transform that pads to bytes.

**Files changed:**
- New: `lib/protocol-transforms.ts` - encode transform registry
- `plugins/protocol/steps/protocol-read.ts` - apply transforms before arg building
- `plugins/protocol/steps/protocol-write.ts` - same
- `protocols/chainlink.ts` - add `inputType` and register encode for receiver

### Phase 3: ABI-driven protocol definition

Add `overrides` config to `ProtocolContract`. The derivation pipeline parses the reduced ABI, generates an action for every function in it, applies overrides, and registers standard `ProtocolAction[]`. The reduced ABI is the allowlist - every function present becomes a node, no enable/disable flags.

Migrate one protocol (Chainlink CCIP contracts) to the new shape as proof of concept. Then migrate remaining protocols incrementally. Each migration: take the existing hand-written ABI fragment, verify it matches the on-chain ABI for the included functions, add overrides for non-obvious labels/transforms, delete the hand-written actions array.

**Files changed:**
- `lib/protocol-registry.ts` - add `FunctionOverrides` type, derivation pipeline in `defineProtocol`
- `protocols/chainlink.ts` - migrate CCIP contracts to ABI-driven shape
- Gradually: all other protocol files

### Phase 4: Integration test framework

Add test helper (`buildProtocolCalldata`), sample input generator, and per-protocol integration test files. Wire into CI with RPC env var gating.

**Files changed:**
- New: `lib/test-utils/protocol-calldata.ts` - calldata builder helper
- New: `tests/integration/protocol-chainlink.test.ts` - CCIP integration tests
- Gradually: integration tests for all protocols

## Risks and open questions

**Serialization**: `encode` functions cannot be serialized for the MCP schemas endpoint. The encode registry must be separate from the action definition. The MCP layer sees the derived action with `inputType` (what the user provides) not `type` (what the ABI expects). This is correct - the AI generates user-facing values, not ABI-encoded values.

**Backwards compatibility**: Existing `defineProtocol` calls with hand-written `actions[]` must continue to work throughout migration. The ABI-driven path is opt-in per contract via the `overrides` config. Contracts without `overrides` use the existing `actions` array. Both paths produce the same `ProtocolAction[]` output.

**Auto-fetch ABIs**: Some protocols (Uniswap, Aave) don't inline the ABI - it's auto-fetched from Etherscan at runtime. The ABI-driven form builder needs the ABI at registration time (server startup) to generate actions. Options: inline the ABI (preferred for protocol nodes), or defer action generation to first request (adds complexity). Recommend inlining.

**Template variables in structured inputs**: `TupleInputField` and `ArrayInputField` already support template variables via `TemplateBadgeInput`. No changes needed. But validation must skip template variables in structured fields, same as in flat fields.

**Gas estimation for write actions**: `estimateGas` on write actions may revert for business logic reasons (insufficient balance, unapproved, wrong market ID). The integration test must distinguish encoding errors (test failure) from business logic reverts (expected). The error message heuristic (`INVALID_ARGUMENT` = encoding error, `execution reverted` = business logic) is imperfect but sufficient.
