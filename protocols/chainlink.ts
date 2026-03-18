import { defineProtocol } from "@/lib/protocol-registry";

export default defineProtocol({
  name: "Chainlink",
  slug: "chainlink",
  description:
    "Chainlink oracle price feeds -- read latest prices, round data, decimals, and feed metadata via AggregatorV3Interface",
  website: "https://chain.link",
  icon: "/protocols/chainlink.png",

  contracts: {
    priceFeed: {
      label: "Price Feed (AggregatorV3Interface)",
      userSpecifiedAddress: true,
      // Reference addresses (ETH/USD feeds) for chain-availability metadata.
      // Runtime address comes from user input via the contractAddress config field.
      addresses: {
        // Ethereum Mainnet -- ETH/USD
        "1": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
        // Base -- ETH/USD
        "8453": "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
        // Arbitrum One -- ETH/USD
        "42161": "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
        // Optimism -- ETH/USD
        "10": "0x13e3Ee699D1909E989722E753853AE30b17e08c5",
        // Sepolia Testnet -- ETH/USD
        "11155111": "0x694AA1769357215DE4FAC081bf1f309aDC325306",
      },
    },
  },

  actions: [
    {
      slug: "latest-round-data",
      label: "Get Latest Round Data",
      description:
        "Get the latest price, round ID, and timestamps from a Chainlink price feed",
      type: "read",
      contract: "priceFeed",
      function: "latestRoundData",
      inputs: [],
      outputs: [
        {
          name: "roundId",
          type: "uint80",
          label: "Round ID",
        },
        {
          name: "answer",
          type: "int256",
          label: "Price Answer",
        },
        {
          name: "startedAt",
          type: "uint256",
          label: "Round Started At (Unix)",
        },
        {
          name: "updatedAt",
          type: "uint256",
          label: "Last Updated At (Unix)",
        },
        {
          name: "answeredInRound",
          type: "uint80",
          label: "Answered In Round",
        },
      ],
    },
    {
      slug: "get-round-data",
      label: "Get Round Data",
      description:
        "Get the price and timestamps for a specific historical round from a Chainlink price feed",
      type: "read",
      contract: "priceFeed",
      function: "getRoundData",
      inputs: [
        {
          name: "_roundId",
          type: "uint80",
          label: "Round ID",
        },
      ],
      outputs: [
        {
          name: "roundId",
          type: "uint80",
          label: "Round ID",
        },
        {
          name: "answer",
          type: "int256",
          label: "Price Answer",
        },
        {
          name: "startedAt",
          type: "uint256",
          label: "Round Started At (Unix)",
        },
        {
          name: "updatedAt",
          type: "uint256",
          label: "Last Updated At (Unix)",
        },
        {
          name: "answeredInRound",
          type: "uint80",
          label: "Answered In Round",
        },
      ],
    },
    {
      slug: "latest-answer",
      label: "Get Latest Answer",
      description:
        "Get the latest price answer from a Chainlink price feed (raw integer, divide by 10^decimals for human-readable value)",
      type: "read",
      contract: "priceFeed",
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
      label: "Get Decimals",
      description:
        "Get the number of decimals used by a Chainlink price feed (typically 8 for USD pairs, 18 for ETH pairs)",
      type: "read",
      contract: "priceFeed",
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
      label: "Get Description",
      description:
        "Get the human-readable description of a Chainlink price feed (e.g. ETH / USD)",
      type: "read",
      contract: "priceFeed",
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
      label: "Get Version",
      description:
        "Get the version number of a Chainlink price feed aggregator contract",
      type: "read",
      contract: "priceFeed",
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
