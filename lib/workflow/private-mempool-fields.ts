/**
 * Per-node toggles for private mempool routing (Flashbots Protect).
 * Shared between the Web3 plugin (lib/web3/index.ts) and the protocol
 * registry (lib/protocol-registry.ts) so both write surfaces expose the
 * same controls at the bottom of every write node.
 *
 * See KEEP-137.
 */

import type { ActionConfigFieldBase } from "@/plugins/registry";

// Chain IDs that support private mempool routing.
// Kept in sync with chain-config JSON entries that declare
// `usePrivateMempoolRpc: true`. Update when a new chain gains support.
const SUPPORTED_CHAIN_IDS = ["1"];

export const PRIVATE_MEMPOOL_FIELDS: ActionConfigFieldBase[] = [
  {
    key: "usePrivateMempool",
    label: "Private Mempool",
    type: "toggle",
    defaultValue: false,
    helpTip:
      "Route this transaction through a private mempool (Flashbots Protect) to prevent frontrunning and sandwich attacks. Disables gas sponsorship for this step. Only available on supported chains.",
    showWhen: { field: "network", oneOf: SUPPORTED_CHAIN_IDS },
  },
  {
    key: "strict",
    label: "Strict",
    type: "toggle",
    defaultValue: true,
    helpTip:
      "When the private mempool RPC is unreachable, fail the transaction instead of falling back to the public mempool. Preserves MEV protection at the cost of execution reliability.",
    showWhen: { field: "usePrivateMempool", equals: true },
  },
];
