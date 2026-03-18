import type { ProtocolAction } from "@/lib/protocol-registry";
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

const LATEST_ROUND_OUTPUTS: ProtocolAction["outputs"] = [
  { name: "roundId", type: "uint80", label: "Round ID" },
  { name: "answer", type: "int256", label: "Price Answer" },
  { name: "startedAt", type: "uint256", label: "Round Started At (Unix)" },
  { name: "updatedAt", type: "uint256", label: "Last Updated At (Unix)" },
  { name: "answeredInRound", type: "uint80", label: "Answered In Round" },
];

function feedAction(
  feedSlug: string,
  feedLabel: string,
  contractKey: string
): ProtocolAction {
  return {
    slug: `${feedSlug}-latest-round-data`,
    label: `Get ${feedLabel} Latest Round Data`,
    description: `Get the latest price, round ID, and timestamps from the Chainlink ${feedLabel} feed`,
    type: "read",
    contract: contractKey,
    function: "latestRoundData",
    inputs: [],
    outputs: LATEST_ROUND_OUTPUTS,
  };
}

export default defineProtocol({
  name: "Chainlink",
  slug: "chainlink",
  description:
    "Chainlink oracle price feeds -- read latest prices, round data, decimals, and feed metadata via AggregatorV3Interface",
  website: "https://chain.link",
  icon: "/protocols/chainlink.png",

  contracts: {
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
    feedAction("eth-usd", "ETH/USD", "ethUsd"),
    feedAction("btc-usd", "BTC/USD", "btcUsd"),
    feedAction("link-usd", "LINK/USD", "linkUsd"),
    feedAction("usdc-usd", "USDC/USD", "usdcUsd"),
    feedAction("dai-usd", "DAI/USD", "daiUsd"),
    feedAction("usdt-usd", "USDT/USD", "usdtUsd"),
    feedAction("link-eth", "LINK/ETH", "linkEth"),
    feedAction("btc-eth", "BTC/ETH", "btcEth"),

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
