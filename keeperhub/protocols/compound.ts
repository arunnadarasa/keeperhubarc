import { defineProtocol } from "@/keeperhub/lib/protocol-registry";

export default defineProtocol({
  name: "Compound V3",
  slug: "compound",
  description:
    "Compound V3 (Comet) lending protocol -- supply assets, borrow base tokens, and monitor balances across isolated markets",
  website: "https://compound.finance",
  icon: "/protocols/compound.png",

  contracts: {
    comet: {
      label: "Comet Market",
      userSpecifiedAddress: true,
      // Reference addresses (USDC market per chain) for chain-availability metadata.
      // Runtime address comes from user input via the contractAddress config field,
      // since each Comet market (USDC, USDT, WETH) is a separate contract.
      addresses: {
        // Ethereum Mainnet (USDC market)
        "1": "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
        // Base (USDC market)
        "8453": "0xb125E6687d4313864e53df431d5425969c15Eb2F",
        // Arbitrum One (USDC market)
        "42161": "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf",
      },
    },
  },

  actions: [
    // Supply / Withdraw

    {
      slug: "supply",
      label: "Supply Asset",
      description:
        "Supply base or collateral assets to a Compound V3 Comet market. Requires prior ERC-20 approval for the Comet contract.",
      type: "write",
      contract: "comet",
      function: "supply",
      inputs: [
        { name: "asset", type: "address", label: "Asset Token Address" },
        { name: "amount", type: "uint256", label: "Amount (wei)" },
      ],
    },
    {
      slug: "withdraw",
      label: "Withdraw Asset",
      description:
        "Withdraw base or collateral assets from a Compound V3 Comet market",
      type: "write",
      contract: "comet",
      function: "withdraw",
      inputs: [
        { name: "asset", type: "address", label: "Asset Token Address" },
        { name: "amount", type: "uint256", label: "Amount (wei)" },
      ],
    },

    // Read Actions

    {
      slug: "get-balance",
      label: "Get Base Balance",
      description:
        "Get the balance of the base asset (e.g. USDC) for an account in a Comet market",
      type: "read",
      contract: "comet",
      function: "balanceOf",
      inputs: [{ name: "account", type: "address", label: "Account Address" }],
      outputs: [
        {
          name: "balance",
          type: "uint256",
          label: "Base Asset Balance",
          decimals: 6,
        },
      ],
    },
    {
      slug: "get-collateral-balance",
      label: "Get Collateral Balance",
      description:
        "Get the collateral balance of a specific asset for an account in a Comet market",
      type: "read",
      contract: "comet",
      function: "collateralBalanceOf",
      inputs: [
        { name: "account", type: "address", label: "Account Address" },
        { name: "asset", type: "address", label: "Collateral Asset Address" },
      ],
      outputs: [
        {
          name: "balance",
          type: "uint256",
          label: "Collateral Balance",
        },
      ],
    },
    {
      slug: "get-borrow-balance",
      label: "Get Borrow Balance",
      description:
        "Get the borrow balance of the base asset for an account in a Comet market",
      type: "read",
      contract: "comet",
      function: "borrowBalanceOf",
      inputs: [{ name: "account", type: "address", label: "Account Address" }],
      outputs: [
        {
          name: "balance",
          type: "uint256",
          label: "Borrow Balance",
          decimals: 6,
        },
      ],
    },
  ],
});
