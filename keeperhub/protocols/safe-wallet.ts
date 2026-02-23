import { defineProtocol } from "@/keeperhub/lib/protocol-registry";

export default defineProtocol({
  name: "Safe",
  slug: "safe-wallet",
  description:
    "Safe multisig wallet -- read owners, threshold, nonce, and module status for any Safe address",
  website: "https://safe.global",
  icon: "/protocols/safe-wallet.png",

  contracts: {
    safe: {
      label: "Safe Multisig",
      userSpecifiedAddress: true,
      // Reference addresses (Safe v1.4.1 Singleton) for chain-availability metadata.
      // Runtime address comes from user input via the contractAddress config field.
      addresses: {
        // Ethereum Mainnet
        "1": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
        // Base
        "8453": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
        // Arbitrum One
        "42161": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
        // Optimism
        "10": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
      },
    },
  },

  actions: [
    // Ownership

    {
      slug: "get-owners",
      label: "Get Owners",
      description: "Get the list of owner addresses for a Safe multisig",
      type: "read",
      contract: "safe",
      function: "getOwners",
      inputs: [],
      outputs: [
        {
          name: "owners",
          type: "address[]",
          label: "Owner Addresses",
        },
      ],
    },
    {
      slug: "get-threshold",
      label: "Get Threshold",
      description:
        "Get the number of required confirmations for a Safe transaction",
      type: "read",
      contract: "safe",
      function: "getThreshold",
      inputs: [],
      outputs: [
        {
          name: "threshold",
          type: "uint256",
          label: "Required Confirmations",
        },
      ],
    },
    {
      slug: "is-owner",
      label: "Is Owner",
      description: "Check if an address is an owner of the Safe multisig",
      type: "read",
      contract: "safe",
      function: "isOwner",
      inputs: [{ name: "owner", type: "address", label: "Address to Check" }],
      outputs: [
        {
          name: "isOwner",
          type: "bool",
          label: "Is Owner",
        },
      ],
    },

    // Transaction State

    {
      slug: "get-nonce",
      label: "Get Nonce",
      description: "Get the current transaction nonce of the Safe multisig",
      type: "read",
      contract: "safe",
      function: "nonce",
      inputs: [],
      outputs: [
        {
          name: "nonce",
          type: "uint256",
          label: "Current Nonce",
        },
      ],
    },

    // Modules

    {
      slug: "is-module-enabled",
      label: "Is Module Enabled",
      description: "Check if a module is enabled on the Safe multisig",
      type: "read",
      contract: "safe",
      function: "isModuleEnabled",
      inputs: [{ name: "module", type: "address", label: "Module Address" }],
      outputs: [
        {
          name: "isEnabled",
          type: "bool",
          label: "Module Enabled",
        },
      ],
    },
  ],
});
