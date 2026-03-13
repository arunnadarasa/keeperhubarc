import { defineProtocol } from "@/keeperhub/lib/protocol-registry";

export default defineProtocol({
  name: "Aerodrome",
  slug: "aerodrome",
  description:
    "Aerodrome Finance -- the leading DEX on Base with volatile/stable pools, ve(3,3) voting, and gauge-based emissions",
  website: "https://aerodrome.finance",
  icon: "/protocols/aerodrome.png",

  contracts: {
    router: {
      label: "Aerodrome Router",
      addresses: {
        // Base
        "8453": "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
      },
      // Inline ABI -- BaseScan auto-fetch fails for this contract
      abi: JSON.stringify([
        {
          type: "function",
          name: "getReserves",
          stateMutability: "view",
          inputs: [
            { name: "tokenA", type: "address" },
            { name: "tokenB", type: "address" },
            { name: "stable", type: "bool" },
            { name: "factory", type: "address" },
          ],
          outputs: [
            { name: "reserveA", type: "uint256" },
            { name: "reserveB", type: "uint256" },
          ],
        },
        {
          type: "function",
          name: "swapExactTokensForTokens",
          stateMutability: "nonpayable",
          inputs: [
            { name: "amountIn", type: "uint256" },
            { name: "amountOutMin", type: "uint256" },
            {
              name: "routes",
              type: "tuple[]",
              components: [
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "stable", type: "bool" },
                { name: "factory", type: "address" },
              ],
            },
            { name: "to", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
          outputs: [{ name: "amounts", type: "uint256[]" }],
        },
      ]),
    },
    voter: {
      label: "Aerodrome Voter",
      addresses: {
        // Base
        "8453": "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
      },
      // Inline ABI -- BaseScan auto-fetch fails for this contract
      abi: JSON.stringify([
        {
          type: "function",
          name: "totalWeight",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
        },
        {
          type: "function",
          name: "isAlive",
          stateMutability: "view",
          inputs: [{ name: "_gauge", type: "address" }],
          outputs: [{ name: "", type: "bool" }],
        },
        {
          type: "function",
          name: "vote",
          stateMutability: "nonpayable",
          inputs: [
            { name: "_tokenId", type: "uint256" },
            { name: "_poolVote", type: "address[]" },
            { name: "_weights", type: "uint256[]" },
          ],
          outputs: [],
        },
        {
          type: "function",
          name: "claimRewards",
          stateMutability: "nonpayable",
          inputs: [{ name: "_gauges", type: "address[]" }],
          outputs: [],
        },
      ]),
    },
    poolFactory: {
      label: "Aerodrome Pool Factory",
      addresses: {
        // Base
        "8453": "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
      },
      // Inline ABI -- BaseScan auto-fetch fails for this contract
      abi: JSON.stringify([
        {
          type: "function",
          name: "allPoolsLength",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
        },
      ]),
    },
    votingEscrow: {
      label: "Aerodrome VotingEscrow (veAERO)",
      addresses: {
        // Base
        "8453": "0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4",
      },
      // Inline ABI -- BaseScan auto-fetch fails for this contract
      abi: JSON.stringify([
        {
          type: "function",
          name: "balanceOfNFT",
          stateMutability: "view",
          inputs: [{ name: "_tokenId", type: "uint256" }],
          outputs: [{ name: "", type: "uint256" }],
        },
        {
          type: "function",
          name: "create_lock",
          stateMutability: "nonpayable",
          inputs: [
            { name: "_value", type: "uint256" },
            { name: "_lockDuration", type: "uint256" },
          ],
          outputs: [{ name: "", type: "uint256" }],
        },
      ]),
    },
    pool: {
      label: "Aerodrome Pool",
      addresses: {
        // Base -- reference address (WETH/USDC pool); runtime address comes from user input
        "8453": "0xcDAC0d6c6C59727a65F871236188350531885C43",
      },
      userSpecifiedAddress: true,
      // Inline ABI -- pool-level getAmountOut
      abi: JSON.stringify([
        {
          type: "function",
          name: "getAmountOut",
          stateMutability: "view",
          inputs: [
            { name: "amountIn", type: "uint256" },
            { name: "tokenIn", type: "address" },
          ],
          outputs: [{ name: "", type: "uint256" }],
        },
      ]),
    },
    aeroToken: {
      label: "AERO Token",
      addresses: {
        // Base
        "8453": "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
      },
      // Inline ABI -- BaseScan auto-fetch fails for this contract
      abi: JSON.stringify([
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
        {
          type: "function",
          name: "approve",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
      ]),
    },
  },

  actions: [
    // Pool Reads

    {
      slug: "get-reserves",
      label: "Get Pool Reserves",
      description:
        "Get the current reserves and block timestamp for an Aerodrome pool",
      type: "read",
      contract: "router",
      function: "getReserves",
      inputs: [
        { name: "tokenA", type: "address", label: "Token A Address" },
        { name: "tokenB", type: "address", label: "Token B Address" },
        { name: "stable", type: "bool", label: "Stable Pool (true/false)" },
        {
          name: "factory",
          type: "address",
          label: "Pool Factory Address",
          default: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
        },
      ],
      outputs: [
        {
          name: "reserveA",
          type: "uint256",
          label: "Reserve A",
          decimals: 18,
        },
        {
          name: "reserveB",
          type: "uint256",
          label: "Reserve B",
          decimals: 18,
        },
      ],
    },
    {
      slug: "get-amount-out",
      label: "Get Expected Output",
      description:
        "Get the expected output amount for a swap from a specific Aerodrome pool",
      type: "read",
      contract: "pool",
      function: "getAmountOut",
      inputs: [
        { name: "amountIn", type: "uint256", label: "Input Amount (wei)" },
        { name: "tokenIn", type: "address", label: "Input Token Address" },
      ],
      outputs: [
        {
          name: "amountOut",
          type: "uint256",
          label: "Expected Output (wei)",
        },
      ],
    },
    {
      slug: "get-all-pools-length",
      label: "Get Total Pool Count",
      description:
        "Get the total number of pools created by the Aerodrome factory",
      type: "read",
      contract: "poolFactory",
      function: "allPoolsLength",
      inputs: [],
      outputs: [
        {
          name: "count",
          type: "uint256",
          label: "Total Pool Count",
        },
      ],
    },

    // Voting Reads

    {
      slug: "get-total-weight",
      label: "Get Total Voting Weight",
      description: "Get the total voting weight across all gauges",
      type: "read",
      contract: "voter",
      function: "totalWeight",
      inputs: [],
      outputs: [
        {
          name: "totalWeight",
          type: "uint256",
          label: "Total Weight",
          decimals: 18,
        },
      ],
    },
    {
      slug: "is-gauge-alive",
      label: "Check Gauge Status",
      description: "Check whether a gauge is active and receiving emissions",
      type: "read",
      contract: "voter",
      function: "isAlive",
      inputs: [{ name: "_gauge", type: "address", label: "Gauge Address" }],
      outputs: [{ name: "alive", type: "bool", label: "Is Alive" }],
    },

    // veNFT Reads

    {
      slug: "get-venft-balance",
      label: "Get veNFT Voting Power",
      description: "Get the current voting power of a veAERO NFT position",
      type: "read",
      contract: "votingEscrow",
      function: "balanceOfNFT",
      inputs: [
        {
          name: "_tokenId",
          type: "uint256",
          label: "veNFT Token ID",
        },
      ],
      outputs: [
        {
          name: "balance",
          type: "uint256",
          label: "Voting Power",
          decimals: 18,
        },
      ],
    },

    // AERO Token Reads

    {
      slug: "aero-balance-of",
      label: "Get AERO Balance",
      description: "Check AERO token balance of an address",
      type: "read",
      contract: "aeroToken",
      function: "balanceOf",
      inputs: [{ name: "account", type: "address", label: "Wallet Address" }],
      outputs: [
        {
          name: "balance",
          type: "uint256",
          label: "AERO Balance",
          decimals: 18,
        },
      ],
    },

    // Write Actions

    {
      slug: "swap-exact-tokens",
      label: "Swap Exact Tokens",
      description:
        "Swap an exact amount of input tokens for as many output tokens as possible via Aerodrome routes",
      type: "write",
      contract: "router",
      function: "swapExactTokensForTokens",
      inputs: [
        { name: "amountIn", type: "uint256", label: "Input Amount (wei)" },
        {
          name: "amountOutMin",
          type: "uint256",
          label: "Minimum Output (wei)",
        },
        { name: "to", type: "address", label: "Recipient Address" },
        {
          name: "deadline",
          type: "uint256",
          label: "Deadline (unix timestamp)",
        },
      ],
    },
    {
      slug: "vote",
      label: "Vote on Gauges",
      description: "Cast votes for pool gauges using veAERO voting power",
      type: "write",
      contract: "voter",
      function: "vote",
      inputs: [
        {
          name: "_tokenId",
          type: "uint256",
          label: "veNFT Token ID",
        },
        {
          name: "_poolVote",
          type: "address[]",
          label: "Pool Addresses (comma-separated)",
        },
        {
          name: "_weights",
          type: "uint256[]",
          label: "Vote Weights (comma-separated)",
        },
      ],
    },
    {
      slug: "create-lock",
      label: "Create veAERO Lock",
      description:
        "Lock AERO tokens to create a veAERO NFT position with voting power",
      type: "write",
      contract: "votingEscrow",
      function: "create_lock",
      inputs: [
        {
          name: "_value",
          type: "uint256",
          label: "AERO Amount (wei)",
          decimals: 18,
        },
        {
          name: "_lockDuration",
          type: "uint256",
          label: "Lock Duration (seconds)",
        },
      ],
    },
    {
      slug: "claim-rewards",
      label: "Claim Gauge Rewards",
      description: "Claim accumulated AERO rewards from a gauge for a veNFT",
      type: "write",
      contract: "voter",
      function: "claimRewards",
      inputs: [
        {
          name: "_gauges",
          type: "address[]",
          label: "Gauge Addresses (comma-separated)",
        },
      ],
    },
    {
      slug: "aero-approve",
      label: "Approve AERO",
      description: "Approve an address to spend AERO tokens",
      type: "write",
      contract: "aeroToken",
      function: "approve",
      inputs: [
        { name: "spender", type: "address", label: "Spender Address" },
        { name: "amount", type: "uint256", label: "Amount (wei)" },
      ],
    },
  ],
});
