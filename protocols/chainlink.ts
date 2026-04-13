import type {
  ProtocolAction,
  ProtocolActionInput,
} from "@/lib/protocol-registry";
import { defineProtocol } from "@/lib/protocol-registry";

// AggregatorV3Interface ABI -- shared across all feed contracts.
// Inline because Arbitrum and Optimism lack Etherscan-compatible explorer configs.
const AGGREGATOR_V3_ABI = JSON.stringify([
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "_roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "latestAnswer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "int256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "description",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
]);

// IRouterClient ABI fragment - getFee (view) and ccipSend (payable).
// The EVM2AnyMessage struct is declared inline as a tuple with components.
const CCIP_ROUTER_ABI = JSON.stringify([
  {
    type: "function",
    name: "getFee",
    stateMutability: "view",
    inputs: [
      { name: "destinationChainSelector", type: "uint64" },
      {
        name: "message",
        type: "tuple",
        components: [
          { name: "receiver", type: "bytes" },
          { name: "data", type: "bytes" },
          {
            name: "tokenAmounts",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "feeToken", type: "address" },
          { name: "extraArgs", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "fee", type: "uint256" }],
  },
  {
    type: "function",
    name: "ccipSend",
    stateMutability: "payable",
    inputs: [
      { name: "destinationChainSelector", type: "uint64" },
      {
        name: "message",
        type: "tuple",
        components: [
          { name: "receiver", type: "bytes" },
          { name: "data", type: "bytes" },
          {
            name: "tokenAmounts",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "feeToken", type: "address" },
          { name: "extraArgs", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "messageId", type: "bytes32" }],
  },
]);

// CCIP-BnM test token ABI fragment - drip mints 1 token to the caller.
const CCIP_BNM_ABI = JSON.stringify([
  {
    type: "function",
    name: "drip",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
]);

// Minimal ERC20 ABI fragment for CCIP pre-flight actions (approve, balanceOf,
// allowance). Used by the ccipErc20 contract for token approval and checks.
const CCIP_ERC20_ABI = JSON.stringify([
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
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
]);

// EVMExtraArgsV1 with gasLimit=0 - for EOA token transfers where no
// ccipReceive callback runs on the destination. Setting gasLimit explicitly
// to 0 avoids CCIP charging a fee for the default 200k gas.
const EXTRA_ARGS_V1_GAS_LIMIT_ZERO =
  "0x97a657c90000000000000000000000000000000000000000000000000000000000000000";

// Shared inputs for ccipSend and getFee - the EVM2AnyMessage struct
// flattened into individual fields for the protocol registry's flat-input
// model. reshapeArgsForAbi packs them back into the tuple at runtime.
const CCIP_MESSAGE_INPUTS: ProtocolActionInput[] = [
  {
    name: "destinationChainSelector",
    type: "uint64",
    label: "Destination Chain Selector",
    helpTip:
      "CCIP chain selector (not chain ID). See https://docs.chain.link/ccip/directory for values.",
  },
  {
    name: "receiver",
    type: "bytes",
    label: "Receiver (abi-encoded address)",
    helpTip:
      "The receiver address abi-encoded as bytes. For an EVM address 0xABC...DEF, pass 0x000000000000000000000000ABC...DEF (left-padded to 32 bytes).",
  },
  {
    name: "data",
    type: "bytes",
    label: "Data Payload",
    default: "0x",
    helpTip:
      "Arbitrary data to send with the message. Use 0x for token-only transfers.",
  },
  {
    name: "tokenAmounts",
    type: "tuple[]",
    label: "Token Amounts (JSON)",
    helpTip:
      'JSON array of {token, amount} objects. Example: [{"token":"0xFd57...2a05","amount":"100000000000000000"}]',
  },
  {
    name: "feeToken",
    type: "address",
    label: "Fee Token Address",
    helpTip:
      "Address of the token used to pay CCIP fees (typically LINK). Use 0x0000000000000000000000000000000000000000 to pay in native gas.",
  },
  {
    name: "extraArgs",
    type: "bytes",
    label: "Extra Args (advanced)",
    default: EXTRA_ARGS_V1_GAS_LIMIT_ZERO,
    helpTip:
      "Versioned CCIP execution options. Default is EVMExtraArgsV1 with gasLimit=0, correct for EOA token transfers. Only change if sending data to a contract that implements ccipReceive.",
  },
];

const LATEST_ROUND_OUTPUTS: ProtocolAction["outputs"] = [
  { name: "roundId", type: "uint80", label: "Round ID" },
  { name: "answer", type: "int256", label: "Price Answer" },
  { name: "startedAt", type: "uint256", label: "Round Started At (Unix)" },
  { name: "updatedAt", type: "uint256", label: "Last Updated At (Unix)" },
  { name: "answeredInRound", type: "uint80", label: "Answered In Round" },
];

function feedActions(
  feedSlug: string,
  feedLabel: string,
  contractKey: string
): ProtocolAction[] {
  return [
    {
      slug: `${feedSlug}-latest-round-data`,
      label: `Get ${feedLabel} Latest Round Data`,
      description: `Get the latest price, round ID, and timestamps from the Chainlink ${feedLabel} feed`,
      type: "read",
      contract: contractKey,
      function: "latestRoundData",
      inputs: [],
      outputs: LATEST_ROUND_OUTPUTS,
    },
    {
      slug: `${feedSlug}-decimals`,
      label: `Get ${feedLabel} Decimals`,
      description: `Get the number of decimals used by the Chainlink ${feedLabel} feed`,
      type: "read",
      contract: contractKey,
      function: "decimals",
      inputs: [],
      outputs: [
        {
          name: "decimals",
          type: "uint8",
          label: "Decimals",
        },
      ],
    },
  ];
}

export default defineProtocol({
  name: "Chainlink",
  slug: "chainlink",
  description:
    "Chainlink oracle price feeds and CCIP cross-chain messaging - read prices via AggregatorV3Interface, bridge tokens and data via CCIP Router",
  website: "https://chain.link",
  icon: "/protocols/chainlink.png",

  contracts: {
    ccipRouter: {
      label: "CCIP Router",
      abi: CCIP_ROUTER_ABI,
      addresses: {
        "1": "0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D",
        "8453": "0x881e3A65B4d4a04dD529061dd0071cf975F58bCD",
        "42161": "0x141fa059441E0ca23ce184B6A78bafD2A517DdE8",
        "56": "0x34B03Cb9086d7D758AC55af71584F81A598759FE",
        "137": "0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe",
        "43114": "0xF4c7E640EdA248ef95972845a62bdC74237805dB",
        "11155111": "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59",
        "84532": "0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93",
        "97": "0xE1053aE1857476f36A3C62580FF9b016E8EE8F6f",
        "80002": "0x9C32fCB86BF0f4a1A8921a9Fe46de3198bb884B2",
        "421614": "0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165",
        "43113": "0xF694E193200268f9a4868e4Aa017A0118C9a8177",
      },
    },
    ccipErc20: {
      label: "ERC-20 Token (for CCIP approvals and checks)",
      userSpecifiedAddress: true,
      abi: CCIP_ERC20_ABI,
      addresses: {
        "1": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        "8453": "0x4200000000000000000000000000000000000006",
        "42161": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        "56": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        "137": "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
        "43114": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
        "11155111": "0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05",
        "84532": "0x88A2d74F47a237a62e7A51cdDa67270CE381555e",
        "97": "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
        "80002": "0x0000000000000000000000000000000000001010",
        "421614": "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73",
        "43113": "0xd00ae08403B9bbb9124bB305C09058E32C39A48c",
      },
    },
    ccipBnM: {
      label: "CCIP-BnM Test Token",
      abi: CCIP_BNM_ABI,
      addresses: {
        "11155111": "0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05",
        "84532": "0x88A2d74F47a237a62e7A51cdDa67270CE381555e",
      },
    },
    ethUsd: {
      label: "ETH/USD Price Feed",
      abi: AGGREGATOR_V3_ABI,
      addresses: {
        "1": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
        "8453": "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
        "42161": "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
        "10": "0x13e3Ee699D1909E989722E753853AE30b17e08c5",
        "11155111": "0x694AA1769357215DE4FAC081bf1f309aDC325306",
      },
    },
    btcUsd: {
      label: "BTC/USD Price Feed",
      abi: AGGREGATOR_V3_ABI,
      addresses: {
        "1": "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
        "8453": "0x03Df23A32C83cA8cD9B1aAC0aF1c72924af7502b",
        "42161": "0x06047dD6f43552831BB51319917DC0C99c29A44c",
        "10": "0xD702DD976Fb76Fffc2D3963D037dfDae5b04E593",
        "11155111": "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
      },
    },
    linkUsd: {
      label: "LINK/USD Price Feed",
      abi: AGGREGATOR_V3_ABI,
      addresses: {
        "1": "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c",
        "8453": "0x17CAb8FE31E32f08326e5E27412894e49B0f9D65",
        "42161": "0x3EAbF62EB761BD86c71d07AdBb1A9183FeC24064",
        "10": "0xCc232dcFAAE6354cE191Bd574108c1aD03f86450",
      },
    },
    usdcUsd: {
      label: "USDC/USD Price Feed",
      abi: AGGREGATOR_V3_ABI,
      addresses: {
        "1": "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
        "8453": "0x1401Fd60F9ba4F718a2fE6149aadf3d1F0dB1b0A",
        "42161": "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3",
        "10": "0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3",
      },
    },
    daiUsd: {
      label: "DAI/USD Price Feed",
      abi: AGGREGATOR_V3_ABI,
      addresses: {
        "1": "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9",
        "8453": "0x591e79239a7d679378eC8c847e5038150364C78F",
        "42161": "0xc5C8E77B397E531B8EC06BFb0048328B30E9eCfB",
        "10": "0x8dBa75e83DA73cc766A7e5a0ee71F656BAb470d6",
      },
    },
    usdtUsd: {
      label: "USDT/USD Price Feed",
      abi: AGGREGATOR_V3_ABI,
      addresses: {
        "1": "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D",
        "8453": "0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9",
        "42161": "0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7",
        "10": "0xECef79E109e997bCA29c1c0897ec9d7b03647F5E",
      },
    },
    linkEth: {
      label: "LINK/ETH Price Feed",
      abi: AGGREGATOR_V3_ABI,
      addresses: {
        "1": "0xDC530D9457755926550b59e8ECcdaE7624181557",
        "8453": "0xc5E65227fe3385B88468F9A01600017cDC9F3A12",
        "42161": "0xb7c8Fb1dB45007F98A68Da0588e1AA524C317f27",
        "10": "0x464A1515ADc20de946f8d0DEB99cead8CEAE310d",
      },
    },
    btcEth: {
      label: "BTC/ETH Price Feed",
      abi: AGGREGATOR_V3_ABI,
      addresses: {
        "1": "0xdeb288F737066589598e9214E782fa5A8eD689e8",
        "42161": "0xc5a90A6d7e4Af242dA238FFe279e9f2BA0c64B2e",
      },
    },
    customFeed: {
      label: "Custom Price Feed (AggregatorV3Interface)",
      userSpecifiedAddress: true,
      abi: AGGREGATOR_V3_ABI,
      // Reference addresses (ETH/USD feeds) for chain-availability metadata.
      // Runtime address comes from user input via the contractAddress config field.
      addresses: {
        "1": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
        "8453": "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
        "42161": "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
        "10": "0x13e3Ee699D1909E989722E753853AE30b17e08c5",
        "11155111": "0x694AA1769357215DE4FAC081bf1f309aDC325306",
      },
    },
  },

  actions: [
    // Pre-populated feed actions -- one-click, no address needed
    ...feedActions("eth-usd", "ETH/USD", "ethUsd"),
    ...feedActions("btc-usd", "BTC/USD", "btcUsd"),
    ...feedActions("link-usd", "LINK/USD", "linkUsd"),
    ...feedActions("usdc-usd", "USDC/USD", "usdcUsd"),
    ...feedActions("dai-usd", "DAI/USD", "daiUsd"),
    ...feedActions("usdt-usd", "USDT/USD", "usdtUsd"),
    ...feedActions("link-eth", "LINK/ETH", "linkEth"),
    ...feedActions("btc-eth", "BTC/ETH", "btcEth"),

    // CCIP actions

    {
      slug: "ccip-get-fee",
      label: "CCIP Get Fee",
      description:
        "Quote the LINK (or native) fee for a CCIP cross-chain message before sending",
      type: "read",
      contract: "ccipRouter",
      function: "getFee",
      inputs: CCIP_MESSAGE_INPUTS,
      outputs: [{ name: "fee", type: "uint256", label: "Fee Amount (wei)" }],
    },
    {
      slug: "ccip-send",
      label: "CCIP Send",
      description:
        "Send a cross-chain message (token transfer and/or arbitrary data) via Chainlink CCIP",
      type: "write",
      contract: "ccipRouter",
      function: "ccipSend",
      payable: true,
      inputs: CCIP_MESSAGE_INPUTS,
      outputs: [
        { name: "messageId", type: "bytes32", label: "CCIP Message ID" },
      ],
    },
    {
      slug: "ccip-bnm-drip",
      label: "CCIP-BnM Drip (Testnet)",
      description:
        "Mint 1 CCIP-BnM test token to an address. Testnet only - this token is used for exercising CCIP bridging on Sepolia/Base Sepolia.",
      type: "write",
      contract: "ccipBnM",
      function: "drip",
      inputs: [
        {
          name: "to",
          type: "address",
          label: "Recipient Address",
        },
      ],
    },

    // CCIP pre-flight actions (approve, balance, allowance)

    {
      slug: "ccip-approve-bridge-token",
      label: "CCIP Approve Bridge Token",
      description:
        "Approve the CCIP Router to spend the token you are bridging. Required before ccipSend.",
      type: "write",
      contract: "ccipErc20",
      function: "approve",
      inputs: [
        {
          name: "spender",
          type: "address",
          label: "Spender (CCIP Router)",
          helpTip:
            "The CCIP Router address for your source chain. Must match the router used in the ccipSend step.",
        },
        {
          name: "amount",
          type: "uint256",
          label: "Amount (wei)",
          helpTip:
            "Amount to approve in the token's smallest unit. Must be >= the amount you intend to bridge.",
        },
      ],
    },
    {
      slug: "ccip-approve-fee-token",
      label: "CCIP Approve Fee Token",
      description:
        "Approve the CCIP Router to spend LINK (or another fee token) for bridge fees. Required before ccipSend when paying fees in ERC-20.",
      type: "write",
      contract: "ccipErc20",
      function: "approve",
      inputs: [
        {
          name: "spender",
          type: "address",
          label: "Spender (CCIP Router)",
          helpTip:
            "The CCIP Router address for your source chain. Must match the router used in the ccipSend step.",
        },
        {
          name: "amount",
          type: "uint256",
          label: "Amount (wei)",
          helpTip:
            "Fee ceiling to approve in the fee token's smallest unit. Set higher than the expected fee to avoid reverts (e.g. 1 LINK = 1000000000000000000). Unused allowance is not spent.",
        },
      ],
    },
    {
      slug: "ccip-check-bridge-balance",
      label: "CCIP Check Bridge Token Balance",
      description:
        "Check the balance of the token being bridged. Use before ccipSend to catch insufficient bridge token balances early.",
      type: "read",
      contract: "ccipErc20",
      function: "balanceOf",
      inputs: [
        {
          name: "account",
          type: "address",
          label: "Account Address",
          helpTip: "The address whose bridge token balance to check.",
        },
      ],
      outputs: [
        { name: "balance", type: "uint256", label: "Token Balance (wei)" },
      ],
    },
    {
      slug: "ccip-check-fee-balance",
      label: "CCIP Check Fee Token Balance",
      description:
        "Check the balance of the fee token (LINK or native wrapper). Use before ccipSend to catch insufficient fee token balances early.",
      type: "read",
      contract: "ccipErc20",
      function: "balanceOf",
      inputs: [
        {
          name: "account",
          type: "address",
          label: "Account Address",
          helpTip: "The address whose fee token balance to check.",
        },
      ],
      outputs: [
        { name: "balance", type: "uint256", label: "Token Balance (wei)" },
      ],
    },
    {
      slug: "ccip-check-bridge-allowance",
      label: "CCIP Check Bridge Token Allowance",
      description:
        "Check how much of the bridge token the CCIP Router is approved to spend. Use to verify the approve-bridge-token step succeeded.",
      type: "read",
      contract: "ccipErc20",
      function: "allowance",
      inputs: [
        {
          name: "owner",
          type: "address",
          label: "Token Owner",
          helpTip: "The address that granted the approval (your wallet).",
        },
        {
          name: "spender",
          type: "address",
          label: "Spender (CCIP Router)",
          helpTip: "The CCIP Router address to check allowance for.",
        },
      ],
      outputs: [
        {
          name: "allowance",
          type: "uint256",
          label: "Approved Amount (wei)",
        },
      ],
    },
    {
      slug: "ccip-check-fee-allowance",
      label: "CCIP Check Fee Token Allowance",
      description:
        "Check how much of the fee token (LINK) the CCIP Router is approved to spend. Use to verify the approve-fee-token step succeeded.",
      type: "read",
      contract: "ccipErc20",
      function: "allowance",
      inputs: [
        {
          name: "owner",
          type: "address",
          label: "Token Owner",
          helpTip: "The address that granted the approval (your wallet).",
        },
        {
          name: "spender",
          type: "address",
          label: "Spender (CCIP Router)",
          helpTip: "The CCIP Router address to check allowance for.",
        },
      ],
      outputs: [
        {
          name: "allowance",
          type: "uint256",
          label: "Approved Amount (wei)",
        },
      ],
    },

    // Custom feed actions -- user provides any AggregatorV3 address
    {
      slug: "latest-round-data",
      label: "Get Latest Round Data (Custom Feed)",
      description:
        "Get the latest price, round ID, and timestamps from any Chainlink price feed",
      type: "read",
      contract: "customFeed",
      function: "latestRoundData",
      inputs: [],
      outputs: LATEST_ROUND_OUTPUTS,
    },
    {
      slug: "get-round-data",
      label: "Get Round Data (Custom Feed)",
      description:
        "Get the price and timestamps for a specific historical round from any Chainlink price feed",
      type: "read",
      contract: "customFeed",
      function: "getRoundData",
      inputs: [
        {
          name: "_roundId",
          type: "uint80",
          label: "Round ID",
        },
      ],
      outputs: LATEST_ROUND_OUTPUTS,
    },
    {
      slug: "latest-answer",
      label: "Get Latest Answer (Custom Feed)",
      description:
        "Get the latest price answer from any Chainlink price feed (raw integer, divide by 10^decimals for human-readable value)",
      type: "read",
      contract: "customFeed",
      function: "latestAnswer",
      inputs: [],
      outputs: [
        {
          name: "answer",
          type: "int256",
          label: "Latest Price Answer",
        },
      ],
    },
    {
      slug: "decimals",
      label: "Get Decimals (Custom Feed)",
      description:
        "Get the number of decimals used by a Chainlink price feed (typically 8 for USD pairs, 18 for ETH pairs)",
      type: "read",
      contract: "customFeed",
      function: "decimals",
      inputs: [],
      outputs: [
        {
          name: "decimals",
          type: "uint8",
          label: "Decimals",
        },
      ],
    },
    {
      slug: "description",
      label: "Get Description (Custom Feed)",
      description:
        "Get the human-readable description of any Chainlink price feed (e.g. ETH / USD)",
      type: "read",
      contract: "customFeed",
      function: "description",
      inputs: [],
      outputs: [
        {
          name: "description",
          type: "string",
          label: "Feed Description",
        },
      ],
    },
    {
      slug: "version",
      label: "Get Version (Custom Feed)",
      description:
        "Get the version number of any Chainlink price feed aggregator contract",
      type: "read",
      contract: "customFeed",
      function: "version",
      inputs: [],
      outputs: [
        {
          name: "version",
          type: "uint256",
          label: "Aggregator Version",
        },
      ],
    },
  ],
});
