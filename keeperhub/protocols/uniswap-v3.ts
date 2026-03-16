import { defineProtocol } from "@/keeperhub/lib/protocol-registry";

export default defineProtocol({
  name: "Uniswap V3",
  slug: "uniswap",
  description:
    "Uniswap V3 -- pool discovery, liquidity positions, swaps, and quotes",
  website: "https://uniswap.org",
  icon: "/protocols/uniswap.png",

  contracts: {
    factory: {
      label: "Uniswap V3 Factory",
      addresses: {
        "1": "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        "8453": "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
        "42161": "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        "10": "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        "11155111": "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",
      },
    },
    positionManager: {
      label: "NonfungiblePositionManager",
      addresses: {
        "1": "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        "8453": "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
        "42161": "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        "10": "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        "11155111": "0x1238536071E1c677A632429e3655c799b22cDA52",
      },
    },
    swapRouter: {
      label: "SwapRouter02",
      addresses: {
        "1": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        "8453": "0x2626664c2603336E57B271c5C0b26F421741e481",
        "42161": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        "10": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        "11155111": "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
      },
    },
    quoter: {
      label: "QuoterV2",
      addresses: {
        "1": "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        "8453": "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
        "42161": "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        "10": "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        "11155111": "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3",
      },
    },
  },

  actions: [
    // Pool Discovery

    {
      slug: "get-pool",
      label: "Get Pool Address",
      description:
        "Find the Uniswap V3 pool address for a token pair and fee tier",
      type: "read",
      contract: "factory",
      function: "getPool",
      inputs: [
        { name: "tokenA", type: "address", label: "Token A Address" },
        { name: "tokenB", type: "address", label: "Token B Address" },
        {
          name: "fee",
          type: "uint24",
          label: "Fee Tier (100, 500, 3000, or 10000)",
        },
      ],
      outputs: [{ name: "pool", type: "address", label: "Pool Address" }],
    },

    // Position Reads

    {
      slug: "get-position",
      label: "Get Position Details",
      description: "Get full details of a liquidity position by NFT token ID",
      type: "read",
      contract: "positionManager",
      function: "positions",
      inputs: [
        { name: "tokenId", type: "uint256", label: "Position Token ID" },
      ],
      outputs: [
        { name: "nonce", type: "uint96", label: "Nonce" },
        { name: "operator", type: "address", label: "Operator Address" },
        { name: "token0", type: "address", label: "Token 0 Address" },
        { name: "token1", type: "address", label: "Token 1 Address" },
        { name: "fee", type: "uint24", label: "Fee Tier" },
        { name: "tickLower", type: "int24", label: "Lower Tick" },
        { name: "tickUpper", type: "int24", label: "Upper Tick" },
        { name: "liquidity", type: "uint128", label: "Liquidity" },
        {
          name: "feeGrowthInside0LastX128",
          type: "uint256",
          label: "Fee Growth Inside 0 (X128)",
        },
        {
          name: "feeGrowthInside1LastX128",
          type: "uint256",
          label: "Fee Growth Inside 1 (X128)",
        },
        { name: "tokensOwed0", type: "uint128", label: "Tokens Owed 0" },
        { name: "tokensOwed1", type: "uint128", label: "Tokens Owed 1" },
      ],
    },
    {
      slug: "balance-of",
      label: "Get Position Count",
      description: "Check how many LP position NFTs an address owns",
      type: "read",
      contract: "positionManager",
      function: "balanceOf",
      inputs: [{ name: "owner", type: "address", label: "Wallet Address" }],
      outputs: [{ name: "balance", type: "uint256", label: "Position Count" }],
    },
    {
      slug: "owner-of",
      label: "Get Position Owner",
      description: "Get the owner address of a liquidity position NFT",
      type: "read",
      contract: "positionManager",
      function: "ownerOf",
      inputs: [
        { name: "tokenId", type: "uint256", label: "Position Token ID" },
      ],
      outputs: [{ name: "owner", type: "address", label: "Owner Address" }],
    },

    // Quotes (read-only, struct params)

    {
      slug: "quote-exact-input",
      label: "Quote Exact Input",
      description:
        "Get the expected output amount for a single-hop exact-input swap",
      type: "read",
      contract: "quoter",
      function: "quoteExactInputSingle",
      inputs: [
        { name: "tokenIn", type: "address", label: "Input Token Address" },
        { name: "tokenOut", type: "address", label: "Output Token Address" },
        { name: "amountIn", type: "uint256", label: "Amount In (wei)" },
        {
          name: "fee",
          type: "uint24",
          label: "Fee Tier (100, 500, 3000, or 10000)",
        },
        {
          name: "sqrtPriceLimitX96",
          type: "uint160",
          label: "Price Limit (0 for none)",
          default: "0",
        },
      ],
      outputs: [
        { name: "amountOut", type: "uint256", label: "Amount Out (wei)" },
        {
          name: "sqrtPriceX96After",
          type: "uint160",
          label: "Price After Swap",
        },
        {
          name: "initializedTicksCrossed",
          type: "uint32",
          label: "Ticks Crossed",
        },
        { name: "gasEstimate", type: "uint256", label: "Gas Estimate" },
      ],
    },
    {
      slug: "quote-exact-output",
      label: "Quote Exact Output",
      description:
        "Get the required input amount for a single-hop exact-output swap",
      type: "read",
      contract: "quoter",
      function: "quoteExactOutputSingle",
      inputs: [
        { name: "tokenIn", type: "address", label: "Input Token Address" },
        { name: "tokenOut", type: "address", label: "Output Token Address" },
        {
          name: "amount",
          type: "uint256",
          label: "Desired Output Amount (wei)",
        },
        {
          name: "fee",
          type: "uint24",
          label: "Fee Tier (100, 500, 3000, or 10000)",
        },
        {
          name: "sqrtPriceLimitX96",
          type: "uint160",
          label: "Price Limit (0 for none)",
          default: "0",
        },
      ],
      outputs: [
        { name: "amountIn", type: "uint256", label: "Amount In (wei)" },
        {
          name: "sqrtPriceX96After",
          type: "uint160",
          label: "Price After Swap",
        },
        {
          name: "initializedTicksCrossed",
          type: "uint32",
          label: "Ticks Crossed",
        },
        { name: "gasEstimate", type: "uint256", label: "Gas Estimate" },
      ],
    },

    // Swaps (write, struct params)

    {
      slug: "swap-exact-input",
      label: "Swap Exact Input",
      description:
        "Swap an exact amount of input tokens for as many output tokens as possible (single-hop)",
      type: "write",
      contract: "swapRouter",
      function: "exactInputSingle",
      inputs: [
        { name: "tokenIn", type: "address", label: "Input Token Address" },
        { name: "tokenOut", type: "address", label: "Output Token Address" },
        {
          name: "fee",
          type: "uint24",
          label: "Fee Tier (100, 500, 3000, or 10000)",
        },
        { name: "recipient", type: "address", label: "Recipient Address" },
        { name: "amountIn", type: "uint256", label: "Amount In (wei)" },
        {
          name: "amountOutMinimum",
          type: "uint256",
          label: "Minimum Output Amount (wei)",
        },
        {
          name: "sqrtPriceLimitX96",
          type: "uint160",
          label: "Price Limit (0 for none)",
          default: "0",
        },
      ],
    },
    {
      slug: "swap-exact-output",
      label: "Swap Exact Output",
      description:
        "Swap as few input tokens as possible for an exact amount of output tokens (single-hop)",
      type: "write",
      contract: "swapRouter",
      function: "exactOutputSingle",
      inputs: [
        { name: "tokenIn", type: "address", label: "Input Token Address" },
        { name: "tokenOut", type: "address", label: "Output Token Address" },
        {
          name: "fee",
          type: "uint24",
          label: "Fee Tier (100, 500, 3000, or 10000)",
        },
        { name: "recipient", type: "address", label: "Recipient Address" },
        {
          name: "amountOut",
          type: "uint256",
          label: "Desired Output Amount (wei)",
        },
        {
          name: "amountInMaximum",
          type: "uint256",
          label: "Maximum Input Amount (wei)",
        },
        {
          name: "sqrtPriceLimitX96",
          type: "uint160",
          label: "Price Limit (0 for none)",
          default: "0",
        },
      ],
    },

    // Position Writes

    {
      slug: "approve-position",
      label: "Approve Position Transfer",
      description:
        "Approve an address to manage a specific liquidity position NFT",
      type: "write",
      contract: "positionManager",
      function: "approve",
      inputs: [
        { name: "to", type: "address", label: "Approved Address" },
        { name: "tokenId", type: "uint256", label: "Position Token ID" },
      ],
    },
    {
      slug: "transfer-position",
      label: "Transfer Position NFT",
      description: "Transfer a liquidity position NFT to another address",
      type: "write",
      contract: "positionManager",
      function: "transferFrom",
      inputs: [
        { name: "from", type: "address", label: "From Address" },
        { name: "to", type: "address", label: "To Address" },
        { name: "tokenId", type: "uint256", label: "Position Token ID" },
      ],
    },
    {
      slug: "burn-position",
      label: "Burn Empty Position",
      description:
        "Burn an empty liquidity position NFT (position must have zero liquidity and zero owed tokens)",
      type: "write",
      contract: "positionManager",
      function: "burn",
      inputs: [
        { name: "tokenId", type: "uint256", label: "Position Token ID" },
      ],
    },
  ],
});
