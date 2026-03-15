import type { ProtocolAction } from "@/keeperhub/lib/protocol-registry";

/**
 * Returns the 13 standard ERC-4626 vault actions for a given contract key.
 * Use this in protocol definitions to avoid duplicating vault action boilerplate.
 *
 * 3 write actions: deposit, withdraw, redeem
 * 10 read actions: asset, totalAssets, totalSupply, balanceOf, convertToAssets,
 *   convertToShares, previewDeposit, previewRedeem, maxDeposit, maxWithdraw
 */
export function erc4626VaultActions(contract: string): ProtocolAction[] {
  return [
    // Write actions

    {
      slug: "vault-deposit",
      label: "Vault Deposit",
      description: "Deposit assets into the ERC-4626 vault and receive shares",
      type: "write",
      contract,
      function: "deposit",
      inputs: [
        { name: "assets", type: "uint256", label: "Asset Amount (wei)" },
        { name: "receiver", type: "address", label: "Receiver Address" },
      ],
    },
    {
      slug: "vault-withdraw",
      label: "Vault Withdraw",
      description:
        "Withdraw assets from the ERC-4626 vault by specifying asset amount",
      type: "write",
      contract,
      function: "withdraw",
      inputs: [
        { name: "assets", type: "uint256", label: "Asset Amount (wei)" },
        { name: "receiver", type: "address", label: "Receiver Address" },
        { name: "owner", type: "address", label: "Share Owner Address" },
      ],
    },
    {
      slug: "vault-redeem",
      label: "Vault Redeem",
      description:
        "Redeem shares from the ERC-4626 vault for underlying assets",
      type: "write",
      contract,
      function: "redeem",
      inputs: [
        { name: "shares", type: "uint256", label: "Shares Amount (wei)" },
        { name: "receiver", type: "address", label: "Receiver Address" },
        { name: "owner", type: "address", label: "Share Owner Address" },
      ],
    },

    // Read actions

    {
      slug: "vault-asset",
      label: "Vault Underlying Asset",
      description:
        "Get the address of the underlying asset token for this vault",
      type: "read",
      contract,
      function: "asset",
      inputs: [],
      outputs: [
        { name: "asset", type: "address", label: "Underlying Asset Address" },
      ],
    },
    {
      slug: "vault-total-assets",
      label: "Vault Total Assets",
      description:
        "Get the total amount of underlying assets held by the vault",
      type: "read",
      contract,
      function: "totalAssets",
      inputs: [],
      outputs: [
        {
          name: "totalAssets",
          type: "uint256",
          label: "Total Assets (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "vault-total-supply",
      label: "Vault Total Supply",
      description: "Get the total supply of vault shares",
      type: "read",
      contract,
      function: "totalSupply",
      inputs: [],
      outputs: [
        {
          name: "totalSupply",
          type: "uint256",
          label: "Total Shares (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "vault-balance",
      label: "Vault Share Balance",
      description: "Get the vault share balance of an address",
      type: "read",
      contract,
      function: "balanceOf",
      inputs: [{ name: "account", type: "address", label: "Wallet Address" }],
      outputs: [
        {
          name: "balance",
          type: "uint256",
          label: "Share Balance (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "vault-convert-to-assets",
      label: "Convert Shares to Assets",
      description:
        "Convert a vault share amount to its underlying asset value at the current rate",
      type: "read",
      contract,
      function: "convertToAssets",
      inputs: [
        { name: "shares", type: "uint256", label: "Shares Amount (wei)" },
      ],
      outputs: [
        {
          name: "assets",
          type: "uint256",
          label: "Asset Value (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "vault-convert-to-shares",
      label: "Convert Assets to Shares",
      description:
        "Convert an asset amount to the equivalent vault shares at the current rate",
      type: "read",
      contract,
      function: "convertToShares",
      inputs: [
        { name: "assets", type: "uint256", label: "Asset Amount (wei)" },
      ],
      outputs: [
        {
          name: "shares",
          type: "uint256",
          label: "Shares Amount (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "vault-preview-deposit",
      label: "Preview Vault Deposit",
      description: "Preview how many shares a given asset deposit would yield",
      type: "read",
      contract,
      function: "previewDeposit",
      inputs: [
        { name: "assets", type: "uint256", label: "Asset Amount (wei)" },
      ],
      outputs: [
        {
          name: "shares",
          type: "uint256",
          label: "Shares Received (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "vault-preview-redeem",
      label: "Preview Vault Redeem",
      description:
        "Preview how many assets a given share redemption would yield",
      type: "read",
      contract,
      function: "previewRedeem",
      inputs: [
        { name: "shares", type: "uint256", label: "Shares Amount (wei)" },
      ],
      outputs: [
        {
          name: "assets",
          type: "uint256",
          label: "Assets Received (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "vault-max-deposit",
      label: "Max Vault Deposit",
      description:
        "Get the maximum amount of assets that can be deposited for a receiver",
      type: "read",
      contract,
      function: "maxDeposit",
      inputs: [
        { name: "receiver", type: "address", label: "Receiver Address" },
      ],
      outputs: [
        {
          name: "maxAssets",
          type: "uint256",
          label: "Max Deposit (wei)",
          decimals: 18,
        },
      ],
    },
    {
      slug: "vault-max-withdraw",
      label: "Max Vault Withdraw",
      description:
        "Get the maximum amount of assets that can be withdrawn by an owner",
      type: "read",
      contract,
      function: "maxWithdraw",
      inputs: [{ name: "owner", type: "address", label: "Owner Address" }],
      outputs: [
        {
          name: "maxAssets",
          type: "uint256",
          label: "Max Withdraw (wei)",
          decimals: 18,
        },
      ],
    },
  ];
}
