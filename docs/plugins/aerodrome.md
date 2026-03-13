---
title: "Aerodrome"
description: "Aerodrome Finance DEX on Base -- pool reserves, swap quotes, ve(3,3) voting, gauge management, and AERO token operations."
---

# Aerodrome

Aerodrome Finance is the leading decentralized exchange on Base, built as a fork of Velodrome V2. It uses a ve(3,3) model with concentrated and volatile liquidity pools, voting escrow tokenomics, and gauge-based emissions. This plugin provides actions for querying pool state, checking voting power, managing veAERO locks, and executing swaps.

Supported chains: Base (8453). Read-only actions work without credentials. Write actions require a connected wallet.

## Actions

| Action | Type | Credentials | Description |
|--------|------|-------------|-------------|
| Get Pool Reserves | Read | No | Get current reserves for a token pair pool |
| Get Expected Output | Read | No | Get expected output amount for a swap |
| Get Total Pool Count | Read | No | Get total number of pools in the factory |
| Get Total Voting Weight | Read | No | Get total voting weight across all gauges |
| Check Gauge Status | Read | No | Check whether a gauge is active |
| Get veNFT Voting Power | Read | No | Get voting power of a veAERO NFT |
| Get AERO Balance | Read | No | Check AERO token balance of an address |
| Swap Exact Tokens | Write | Wallet | Swap exact input tokens for output tokens |
| Vote on Gauges | Write | Wallet | Cast votes for pool gauges using veAERO |
| Create veAERO Lock | Write | Wallet | Lock AERO tokens to create a veNFT |
| Claim Gauge Rewards | Write | Wallet | Claim accumulated rewards from gauges |
| Approve AERO | Write | Wallet | Approve an address to spend AERO tokens |

---

## Get Pool Reserves

Get the current reserves and block timestamp for an Aerodrome pool. Useful for monitoring pool depth and calculating prices.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| tokenA | address | Token A Address |
| tokenB | address | Token B Address |
| stable | bool | Stable Pool (true/false) |
| factory | address | Pool Factory Address (defaults to Aerodrome factory) |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| reserveA | uint256 | Reserve A (18 decimals) |
| reserveB | uint256 | Reserve B (18 decimals) |

**When to use:** Monitor pool liquidity depth, calculate token prices from reserves, detect significant reserve changes, build liquidity monitoring dashboards.

---

## Get Expected Output

Get the expected output amount for a swap given an input amount. Returns both the expected output and whether the optimal route uses a stable or volatile pool.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| amountIn | uint256 | Input Amount (wei) |
| tokenIn | address | Input Token Address |
| tokenOut | address | Output Token Address |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| amount | uint256 | Expected Output (wei) |
| stable | bool | Stable Pool Used |

**When to use:** Get swap quotes before executing, compare prices across pools, build price monitoring workflows.

---

## Get Total Pool Count

Get the total number of pools created by the Aerodrome factory. Useful for tracking protocol growth.

**Inputs:** None

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| count | uint256 | Total Pool Count |

**When to use:** Monitor protocol growth, track new pool deployments, build protocol analytics dashboards.

---

## Get Total Voting Weight

Get the total voting weight across all gauges in the Aerodrome Voter contract.

**Inputs:** None

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| totalWeight | uint256 | Total Weight (18 decimals) |

**When to use:** Monitor overall voting activity, calculate gauge weight percentages, track voting participation over time.

---

## Check Gauge Status

Check whether a gauge is active and receiving emissions. Inactive gauges do not distribute rewards.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| _gauge | address | Gauge Address |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| alive | bool | Is Alive |

**When to use:** Verify a gauge is active before voting, monitor gauge health, detect gauge deactivation for alerting.

---

## Get veNFT Voting Power

Get the current voting power of a veAERO NFT position. Voting power decays linearly over the lock duration.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| _tokenId | uint256 | veNFT Token ID |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| balance | uint256 | Voting Power (18 decimals) |

**When to use:** Monitor voting power decay, plan lock extensions, track veNFT positions for governance participation.

---

## Get AERO Balance

Check the AERO token balance of an address.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| account | address | Wallet Address |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| balance | uint256 | AERO Balance (18 decimals) |

**When to use:** Monitor AERO holdings, track reward accumulation, trigger workflows based on balance thresholds.

---

## Swap Exact Tokens

Swap an exact amount of input tokens for as many output tokens as possible via Aerodrome routes.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| amountIn | uint256 | Input Amount (wei) |
| amountOutMin | uint256 | Minimum Output (wei) |
| to | address | Recipient Address |
| deadline | uint256 | Deadline (unix timestamp) |

**Outputs:** `success`, `transactionHash`, `transactionLink`, `error`

**When to use:** Execute token swaps, automate trading strategies, rebalance portfolios.

---

## Vote on Gauges

Cast votes for pool gauges using veAERO voting power. Votes determine emission distribution to liquidity pools.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| _tokenId | uint256 | veNFT Token ID |
| _poolVote | address[] | Pool Addresses (comma-separated) |
| _weights | uint256[] | Vote Weights (comma-separated) |

**Outputs:** `success`, `transactionHash`, `transactionLink`, `error`

**When to use:** Participate in gauge voting, automate weekly vote rebalancing, optimize emission allocation.

---

## Create veAERO Lock

Lock AERO tokens to create a veAERO NFT position with voting power. Longer lock durations yield more voting power.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| _value | uint256 | AERO Amount (wei, 18 decimals) |
| _lockDuration | uint256 | Lock Duration (seconds) |

**Outputs:** `success`, `transactionHash`, `transactionLink`, `error`

**When to use:** Acquire voting power, participate in governance, earn trading fee rebates through voting.

---

## Claim Gauge Rewards

Claim accumulated AERO rewards from gauges.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| _gauges | address[] | Gauge Addresses (comma-separated) |

**Outputs:** `success`, `transactionHash`, `transactionLink`, `error`

**When to use:** Harvest accumulated rewards, automate periodic reward collection, compound rewards into new positions.

---

## Approve AERO

Approve an address to spend AERO tokens on your behalf. Required before creating locks or interacting with contracts that need AERO allowance.

**Inputs:**

| Input | Type | Description |
|-------|------|-------------|
| spender | address | Spender Address |
| amount | uint256 | Amount (wei) |

**Outputs:** `success`, `transactionHash`, `transactionLink`, `error`

**When to use:** Set up allowances before locking AERO, approve contracts for token transfers.

---

## Example Workflows

### Pool Reserve Monitor

`Schedule (hourly) -> Aerodrome: Get Pool Reserves -> Code: Format Reserves -> Condition (reserve < threshold) -> Discord: Low Liquidity Alert`

Monitor an Aerodrome pool's reserves hourly. If either reserve drops below a configured threshold, send a Discord alert with the current reserve values.

### Swap Quote Tracker

`Schedule (every 15 min) -> Aerodrome: Get Expected Output -> Code: Calculate Price -> Condition (price deviation) -> PagerDuty: Price Alert`

Track swap prices for a token pair and alert via PagerDuty webhook when the price deviates significantly from expected.

### veNFT Voting Power Monitor

`Schedule (daily) -> Aerodrome: Get veNFT Voting Power -> Code: Format Power -> Condition (power < minimum) -> SendGrid: Lock Renewal Reminder`

Monitor veAERO voting power decay and send an email reminder when it drops below a threshold, signaling time to extend the lock.

### AERO Balance Dashboard

`Schedule (daily) -> Aerodrome: Get AERO Balance -> Aerodrome: Get veNFT Voting Power -> Code: Summarize -> SendGrid: Daily Report`

Daily email report combining liquid AERO balance and veNFT voting power into a treasury position summary.

---

## Supported Chains

| Chain | Contracts Available |
|-------|-------------------|
| Base (8453) | Router, Voter, Pool Factory, VotingEscrow, AERO Token |

All contracts are available on Base only.
