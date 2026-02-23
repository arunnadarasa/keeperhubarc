---
title: "Safe Wallet"
description: "Read-only Safe multisig wallet actions -- owners, threshold, nonce, and module status on Ethereum, Base, Arbitrum, and Optimism."
---

# Safe Wallet

Safe (formerly Gnosis Safe) is the most widely used multisig wallet on EVM chains. This plugin provides read-only actions for querying Safe multisig state: owner lists, confirmation thresholds, transaction nonces, and module status.

Unlike other protocols with fixed contract addresses, Safe wallets are deployed at user-specific addresses. You provide your Safe address when configuring the workflow action.

Supported chains: Ethereum, Base, Arbitrum, Optimism. All actions are read-only and require no credentials.

## Actions

| Action | Type | Credentials | Description |
|--------|------|-------------|-------------|
| Get Owners | Read | No | Get the list of owner addresses |
| Get Threshold | Read | No | Get the required confirmation count |
| Is Owner | Read | No | Check if an address is an owner |
| Get Nonce | Read | No | Get the current transaction nonce |
| Is Module Enabled | Read | No | Check if a module is enabled |

---

## Get Owners

Get the list of all owner addresses for a Safe multisig wallet.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| contractAddress | address | Safe Multisig Address |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| owners | address[] | Owner Addresses |

**When to use:** Monitor ownership changes, verify signer lists, audit multisig configuration.

---

## Get Threshold

Get the number of required confirmations (M of N) for executing a Safe transaction.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| contractAddress | address | Safe Multisig Address |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| threshold | uint256 | Required Confirmations |

**When to use:** Monitor threshold changes, verify security settings, alert if threshold drops below expected value.

---

## Is Owner

Check whether a specific address is an owner of the Safe multisig.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| contractAddress | address | Safe Multisig Address |
| owner | address | Address to Check |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| isOwner | bool | Is Owner |

**When to use:** Verify address membership, monitor owner additions/removals, validate access control.

---

## Get Nonce

Get the current transaction nonce of the Safe multisig. Each executed transaction increments the nonce.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| contractAddress | address | Safe Multisig Address |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| nonce | uint256 | Current Nonce |

**When to use:** Track transaction activity, detect new executed transactions, monitor Safe usage frequency.

---

## Is Module Enabled

Check whether a specific module is enabled on the Safe multisig. Modules can execute transactions without owner confirmations.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| contractAddress | address | Safe Multisig Address |
| module | address | Module Address |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| isEnabled | bool | Module Enabled |

**When to use:** Audit enabled modules, verify module installation, monitor module changes for security.

---

## Example Workflows

### Monitor Safe Ownership Changes

`Schedule (hourly) -> Safe: Get Owners -> Code (compare with previous) -> Condition (changed) -> Discord: Send Message`

Periodically check the owner list and alert via Discord if any owners are added or removed.

### Threshold Security Alert

`Schedule (daily) -> Safe: Get Threshold -> Condition (< 2) -> SendGrid: Send Email`

Monitor the confirmation threshold and send an email alert if it drops below a safe minimum.

### Transaction Activity Tracker

`Schedule (every 10 min) -> Safe: Get Nonce -> Condition (> previous nonce) -> Discord: Send Message`

Track the Safe nonce to detect newly executed transactions and notify your team in real time.

### Module Audit

`Manual -> Safe: Is Module Enabled -> Condition (is true) -> Discord: Send Message`

Check if a specific module is enabled on your Safe and alert if unexpected modules are found.

---

## Supported Chains

| Chain | Available |
|-------|-----------|
| Ethereum (1) | Safe Multisig |
| Base (8453) | Safe Multisig |
| Arbitrum (42161) | Safe Multisig |
| Optimism (10) | Safe Multisig |

Safe wallets are deployed at unique, user-specified addresses on all four chains. Provide your Safe address when configuring each action.
