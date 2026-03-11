import { defineProtocol } from "@/keeperhub/lib/protocol-registry";

export default defineProtocol({
  name: "Spark",
  slug: "spark",
  description:
    "Spark Protocol (Aave V3 fork) -- lending, borrowing, and sDAI savings in the Sky/Maker ecosystem",
  website: "https://spark.fi",
  icon: "/protocols/spark.png",

  contracts: {
    pool: {
      label: "SparkLend Pool",
      addresses: {
        // Ethereum Mainnet
        "1": "0xC13e21B648A5Ee794902342038FF3aDAB66BE987",
        // Gnosis Chain
        "100": "0x2Dae5307c5E3FD1CF5A72Cb6F698f915860607e0",
      },
      // Proxy contract -- ABI auto-resolved via abi-cache
    },
    poolDataProvider: {
      label: "Spark Pool Data Provider",
      addresses: {
        // Ethereum Mainnet
        "1": "0xFc21d6d146E6086B8359705C8b28512a983db0cb",
        // Gnosis Chain
        "100": "0x2a002054A06546bB5a264D57A81347e23Af91D18",
      },
      // ABI auto-resolved via abi-cache
    },
    sdai: {
      label: "sDAI (Savings DAI)",
      addresses: {
        // Ethereum Mainnet
        "1": "0x83F20F44975D03b1b09e64809B757c47f942BEeA",
      },
      // Proxy contract -- ABI auto-resolved via abi-cache
    },
  },

  actions: [
    // Supply / Withdraw

    {
      slug: "supply",
      label: "Supply Asset",
      description:
        "Supply an asset to the SparkLend lending pool to earn interest",
      type: "write",
      contract: "pool",
      function: "supply",
      inputs: [
        { name: "asset", type: "address", label: "Asset Token Address" },
        { name: "amount", type: "uint256", label: "Amount (wei)" },
        {
          name: "onBehalfOf",
          type: "address",
          label: "On Behalf Of Address",
        },
        {
          name: "referralCode",
          type: "uint16",
          label: "Referral Code",
          default: "0",
        },
      ],
    },
    {
      slug: "withdraw",
      label: "Withdraw Asset",
      description: "Withdraw a supplied asset from the SparkLend lending pool",
      type: "write",
      contract: "pool",
      function: "withdraw",
      inputs: [
        { name: "asset", type: "address", label: "Asset Token Address" },
        { name: "amount", type: "uint256", label: "Amount (wei)" },
        { name: "to", type: "address", label: "Recipient Address" },
      ],
    },

    // Borrow / Repay

    {
      slug: "borrow",
      label: "Borrow Asset",
      description: "Borrow an asset from SparkLend against supplied collateral",
      type: "write",
      contract: "pool",
      function: "borrow",
      inputs: [
        { name: "asset", type: "address", label: "Asset Token Address" },
        { name: "amount", type: "uint256", label: "Amount (wei)" },
        {
          name: "interestRateMode",
          type: "uint256",
          label: "Interest Rate Mode (2=Variable)",
          default: "2",
        },
        {
          name: "referralCode",
          type: "uint16",
          label: "Referral Code",
          default: "0",
        },
        {
          name: "onBehalfOf",
          type: "address",
          label: "On Behalf Of Address",
        },
      ],
    },
    {
      slug: "repay",
      label: "Repay Debt",
      description: "Repay a borrowed asset to the SparkLend lending pool",
      type: "write",
      contract: "pool",
      function: "repay",
      inputs: [
        { name: "asset", type: "address", label: "Asset Token Address" },
        { name: "amount", type: "uint256", label: "Amount (wei)" },
        {
          name: "interestRateMode",
          type: "uint256",
          label: "Interest Rate Mode (2=Variable)",
          default: "2",
        },
        {
          name: "onBehalfOf",
          type: "address",
          label: "On Behalf Of Address",
        },
      ],
    },

    // Collateral Management

    {
      slug: "set-collateral",
      label: "Set Asset as Collateral",
      description:
        "Enable or disable a supplied asset as collateral in SparkLend",
      type: "write",
      contract: "pool",
      function: "setUserUseReserveAsCollateral",
      inputs: [
        { name: "asset", type: "address", label: "Asset Token Address" },
        {
          name: "useAsCollateral",
          type: "bool",
          label: "Use as Collateral",
          helpTip:
            "Toggles the entire supplied balance of this asset as collateral. There is no partial collateral in Aave V3/Spark.",
        },
      ],
    },

    // sDAI (ERC-4626 Savings Vault)

    {
      slug: "deposit-sdai",
      label: "Deposit DAI to sDAI",
      description:
        "Deposit DAI into the sDAI savings vault to earn the DSR (ERC-4626)",
      type: "write",
      contract: "sdai",
      function: "deposit",
      inputs: [
        { name: "assets", type: "uint256", label: "DAI Amount (wei)" },
        { name: "receiver", type: "address", label: "Receiver Address" },
      ],
    },
    {
      slug: "redeem-sdai",
      label: "Redeem sDAI for DAI",
      description: "Redeem sDAI shares for DAI from the savings vault",
      type: "write",
      contract: "sdai",
      function: "redeem",
      inputs: [
        { name: "shares", type: "uint256", label: "sDAI Shares (wei)" },
        { name: "receiver", type: "address", label: "Receiver Address" },
        { name: "owner", type: "address", label: "Share Owner Address" },
      ],
    },

    // Read Actions

    {
      slug: "get-user-account-data",
      label: "Get User Account Data",
      description:
        "Get overall account health including collateral, debt, borrow power, and health factor",
      type: "read",
      contract: "pool",
      function: "getUserAccountData",
      inputs: [{ name: "user", type: "address", label: "User Address" }],
      outputs: [
        {
          name: "totalCollateralBase",
          type: "uint256",
          label: "Total Collateral (base currency)",
          decimals: 8,
        },
        {
          name: "totalDebtBase",
          type: "uint256",
          label: "Total Debt (base currency)",
          decimals: 8,
        },
        {
          name: "availableBorrowsBase",
          type: "uint256",
          label: "Available Borrows (base currency)",
          decimals: 8,
        },
        {
          name: "currentLiquidationThreshold",
          type: "uint256",
          label: "Liquidation Threshold (basis points)",
        },
        {
          name: "ltv",
          type: "uint256",
          label: "Loan-to-Value (basis points)",
        },
        {
          name: "healthFactor",
          type: "uint256",
          label: "Health Factor",
          decimals: 18,
        },
      ],
    },
    {
      slug: "get-user-reserve-data",
      label: "Get User Reserve Data",
      description:
        "Get per-asset position data including supplied balance, debt, and rates",
      type: "read",
      contract: "poolDataProvider",
      function: "getUserReserveData",
      inputs: [
        { name: "asset", type: "address", label: "Asset Token Address" },
        { name: "user", type: "address", label: "User Address" },
      ],
      outputs: [
        {
          name: "currentATokenBalance",
          type: "uint256",
          label: "Supplied Balance (spToken)",
        },
        {
          name: "currentStableDebtTokenBalance",
          type: "uint256",
          label: "Stable Debt Balance",
        },
        {
          name: "currentVariableDebtTokenBalance",
          type: "uint256",
          label: "Variable Debt Balance",
        },
        {
          name: "principalStableDebt",
          type: "uint256",
          label: "Principal Stable Debt",
        },
        {
          name: "scaledVariableDebt",
          type: "uint256",
          label: "Scaled Variable Debt",
        },
        {
          name: "stableBorrowRate",
          type: "uint256",
          label: "Stable Borrow Rate (ray)",
          decimals: 27,
        },
        {
          name: "liquidityRate",
          type: "uint256",
          label: "Supply APY (ray)",
          decimals: 27,
        },
        {
          name: "stableRateLastUpdated",
          type: "uint40",
          label: "Stable Rate Last Updated (timestamp)",
        },
        {
          name: "usageAsCollateralEnabled",
          type: "bool",
          label: "Used as Collateral",
        },
      ],
    },
    {
      slug: "get-sdai-balance",
      label: "Get sDAI Balance",
      description: "Check the sDAI balance of an address",
      type: "read",
      contract: "sdai",
      function: "balanceOf",
      inputs: [{ name: "account", type: "address", label: "Wallet Address" }],
      outputs: [
        {
          name: "balance",
          type: "uint256",
          label: "sDAI Balance (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "get-sdai-total-assets",
      label: "Get sDAI Total Assets",
      description:
        "Get total DAI held in the sDAI vault (total value locked in DSR)",
      type: "read",
      contract: "sdai",
      function: "totalAssets",
      inputs: [],
      outputs: [
        {
          name: "totalAssets",
          type: "uint256",
          label: "Total DAI in Vault (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "get-sdai-convert-to-assets",
      label: "Convert sDAI to DAI Value",
      description:
        "Preview how much DAI a given amount of sDAI is worth at the current rate",
      type: "read",
      contract: "sdai",
      function: "convertToAssets",
      inputs: [{ name: "shares", type: "uint256", label: "sDAI Shares (wei)" }],
      outputs: [
        {
          name: "assets",
          type: "uint256",
          label: "DAI Value (wei)",
          decimals: 18,
        },
      ],
    },
  ],
});
