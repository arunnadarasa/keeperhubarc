import { defineProtocol } from "@/keeperhub/lib/protocol-registry";

export default defineProtocol({
  name: "Rocket Pool",
  slug: "rocket-pool",
  description:
    "Decentralized Ethereum liquid staking -- deposit ETH for rETH, monitor exchange rates, and manage staking positions",
  website: "https://rocketpool.net",
  icon: "/protocols/rocket-pool.png",

  contracts: {
    reth: {
      label: "rETH Token",
      addresses: {
        // Ethereum Mainnet
        "1": "0xae78736Cd615f374D3085123A210448E74Fc6393",
      },
      // Proxy -- ABI auto-resolved via abi-cache
    },
    depositPool: {
      label: "Rocket Deposit Pool",
      addresses: {
        // Ethereum Mainnet
        "1": "0xDD3f50F8A6CafbE9b31a427582963f465E745AF8",
      },
      // Proxy -- ABI auto-resolved via abi-cache
    },
  },

  actions: [
    // Read Actions

    {
      slug: "get-reth-exchange-rate",
      label: "Get rETH Exchange Rate",
      description:
        "Get the current ETH value of 1 rETH (exchange rate from rETH to ETH)",
      type: "read",
      contract: "reth",
      function: "getExchangeRate",
      inputs: [],
      outputs: [
        {
          name: "rate",
          type: "uint256",
          label: "Exchange Rate (wei per rETH)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "get-reth-balance",
      label: "Get rETH Balance",
      description: "Check the rETH balance of an address",
      type: "read",
      contract: "reth",
      function: "balanceOf",
      inputs: [{ name: "account", type: "address", label: "Wallet Address" }],
      outputs: [
        {
          name: "balance",
          type: "uint256",
          label: "rETH Balance (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "get-reth-total-supply",
      label: "Get rETH Total Supply",
      description: "Get the total supply of rETH tokens in circulation",
      type: "read",
      contract: "reth",
      function: "totalSupply",
      inputs: [],
      outputs: [
        {
          name: "totalSupply",
          type: "uint256",
          label: "Total rETH Supply (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "get-total-collateral",
      label: "Get Total ETH Collateral",
      description:
        "Get the total amount of ETH collateral held by the rETH contract",
      type: "read",
      contract: "reth",
      function: "getTotalCollateral",
      inputs: [],
      outputs: [
        {
          name: "totalCollateral",
          type: "uint256",
          label: "Total ETH Collateral (wei)",
          decimals: 18,
        },
      ],
    },

    // Write Actions

    {
      slug: "deposit",
      label: "Deposit ETH for rETH",
      description:
        "Deposit ETH into Rocket Pool to receive rETH liquid staking tokens",
      type: "write",
      contract: "depositPool",
      function: "deposit",
      inputs: [],
      payable: true,
    },
    {
      slug: "burn-reth",
      label: "Burn rETH for ETH",
      description:
        "Burn rETH tokens to receive the underlying ETH back at the current exchange rate",
      type: "write",
      contract: "reth",
      function: "burn",
      inputs: [
        {
          name: "amount",
          type: "uint256",
          label: "rETH Amount (wei)",
          decimals: 18,
        },
      ],
    },
  ],
});
