# E2E Testing

## Test Types

### Vitest E2E

Server-side tests that validate backend functionality: database operations, API endpoints, SQS queue processing, workflow execution, RPC failover, and scheduled pipeline orchestration. Runs in Node.js (not browser).

**Test files:** `tests/e2e/vitest/`

**Key commands:**
- `pnpm test:e2e:vitest` -- all vitest e2e tests
- `pnpm test:e2e:schedule` -- schedule pipeline only
- `pnpm test:e2e:runner` -- workflow runner only

### Playwright E2E

Browser-based tests that validate the full user experience: authentication flows, workflow creation, UI interactions, and end-to-end user journeys. Runs headless Chromium via Playwright, sharded across 2 runners.

**Test files:** `tests/e2e/playwright/`

**Key commands:**
- `pnpm test:e2e` -- all playwright tests
- `pnpm test:e2e --shard=1/2` -- first shard only

---

## Test Contexts

### Local

Tests run against services spun up inside the CI runner:
- PostgreSQL container on `localhost:5432`
- LocalStack (SQS) on `localhost:4566`
- App built and started on `localhost:3000`

Full access to database, SQS queues, and application internals.

### Remote

Tests run against a deployed environment over HTTPS:
- PR environment: `https://app-pr-N.keeperhub.com`
- Staging: `https://app-staging.keeperhub.com`
- Production: `https://app.keeperhub.com`

**PR environments:** Both vitest and playwright run remotely. Vitest gets database access via `kubectl port-forward` to CloudNativePG (`svc/keeperhub-pr-N-db-rw`) and LocalStack (`svc/localstack`). Playwright runs browser tests against the deployed URL.

**Remote vitest exclusions:** Two test files are excluded from remote vitest runs:
- `full-pipeline.test.ts` -- Spawns local `workflow-runner` processes and relies on direct SQS message send/receive. Cannot work remotely because workflow execution happens in K8s, not on the CI runner.
- `write-contract-workflow.test.ts` -- Requires the wallet encryption key to match the environment's seeded data exactly. The PR environment seeds wallets during deployment, and the CI runner's key may not match.

**Remote playwright setup:** Playwright uses admin test API endpoints (`/api/admin/test/otp`, `/api/admin/test/invitation`) for DB lookups when `TEST_API_KEY` + `BASE_URL` are set. `global-setup.ts` runs preflight checks and skips DB seeding in remote mode.

**Staging/prod:** Only playwright runs post-deploy. Vitest is excluded -- see [Design Decisions](#design-decisions) below.

---

## Workflow Architecture

```mermaid
graph TD
    subgraph "PR Push (no labels)"
        A[PR Push] --> B[PR Checks]
        A --> C[PR Title Check]
        A --> D[Maintainability]
    end
```

```mermaid
graph TD
    subgraph "PR + run-e2e-tests-local label"
        A[PR Push] --> B[e2e-tests-local.yml]
        B --> C[e2e-vitest-local]
        C --> D[e2e-playwright-local]
    end
```

```mermaid
graph TD
    subgraph "PR + deploy-pr-environment label"
        A[PR Push] --> B[deploy-pr-environment.yaml]
        B --> C[build-images]
        C --> D[deploy]
    end
```

```mermaid
graph TD
    subgraph "PR + deploy-pr-environment + run-e2e-tests-pr-deploy labels"
        A[PR Push] --> B[deploy-pr-environment.yaml]
        B --> C[build-images]
        C --> D[deploy]
        D --> E[check-e2e-label]
        E --> F[e2e-vitest-remote]
        E --> G[e2e-playwright-remote]
    end
```

```mermaid
graph TD
    subgraph "Push to staging/prod"
        A[Merge to staging/prod] --> B[e2e-tests-local.yml]
        B --> C[e2e-vitest-local]
        C --> D[e2e-playwright-local]
        D --> E{Tests pass?}
        E -->|Yes| F[deploy-keeperhub.yaml]
        F --> G[build-and-deploy]
        G --> H[e2e-playwright-remote]
        E -->|No| J[Deploy blocked]
    end
```

---

## Workflow Files

| File | Trigger | Jobs |
|---|---|---|
| `e2e-tests-local.yml` | Push to staging/prod, PR with `run-e2e-tests-local` label | `e2e-vitest-local`, `e2e-playwright-local` |
| `deploy-pr-environment.yaml` | PR with `deploy-pr-environment` label | `build-images`, `deploy`, `e2e-vitest-remote`, `e2e-playwright-remote` (remote tests gated by `run-e2e-tests-pr-deploy` label) |
| `deploy-keeperhub.yaml` | `workflow_run` after E2E Tests Local passes on staging/prod | `build-and-deploy`, `e2e-playwright-remote` |

---

## Label Reference

| Label | Effect |
|---|---|
| `run-e2e-tests-local` | Runs local vitest + playwright on the PR |
| `deploy-pr-environment` | Deploys an isolated PR environment to EKS |
| `run-e2e-tests-pr-deploy` | Runs remote vitest + playwright against the deployed PR environment (requires `deploy-pr-environment`) |

---

## Environment Variables by Context

### Local tests

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/keeperhub_test` |
| `AWS_ENDPOINT_URL` | `http://localhost:4566` |
| `KEEPERHUB_URL` | `http://localhost:3000` |

### Remote tests (PR environment)

Vitest gets DB access via kubectl port-forward to the PR environment's CloudNativePG and LocalStack services.

| Variable | Value |
|---|---|
| `KEEPERHUB_URL` / `BASE_URL` | `https://app-pr-N.keeperhub.com` |
| `DATABASE_URL` | `postgresql://keeperhub:<password>@localhost:5432/keeperhub` (via port-forward to `svc/keeperhub-pr-N-db-rw`) |
| `AWS_ENDPOINT_URL` | `http://localhost:4566` (via port-forward to `svc/localstack`) |

### Remote tests (staging/prod)

Only Playwright runs post-deploy on staging/prod. Vitest is not run remotely against staging/prod because those tests do direct DB writes (inserts, deletes, advisory locks) which could corrupt live data. The local vitest suite already gates the deploy, and Playwright verifies the deployment through the application layer (API calls with proper auth/validation).

| Variable | Value |
|---|---|
| `BASE_URL` | `https://app-staging.keeperhub.com` or `https://app.keeperhub.com` |

---

## Design Decisions

### No vitest-remote on staging/prod

Vitest E2E tests are not run against staging/prod after deployment. Only Playwright runs as a post-deploy verification step.

**Why:** 10 of 12 vitest e2e tests perform direct database writes via Drizzle ORM -- inserting users, organizations, workflows, wallet locks, and executing PostgreSQL advisory locks. These operations bypass the application layer entirely (no auth, no validation, no rate limiting). Running them against a live staging/prod database risks corrupting real data.

**Why Playwright is safe for this:** Playwright tests interact exclusively through the browser and HTTP API layer. All data mutations go through the application's authentication, authorization, and validation logic. The app controls what gets written.

**What covers the gap:**
- **Pre-deploy gate:** `e2e-vitest-ephemeral` runs against an isolated database before the deploy is allowed to proceed. This validates all backend logic.
- **Post-deploy verification:** `e2e-playwright-remote` confirms the deployed application is functional end-to-end through the UI, using admin test API endpoints for DB lookups.
- **PR environments:** `e2e-vitest-remote` runs with full DB access on PR deploys, where each PR has an isolated CloudNativePG instance. No risk to shared data.

**If this needs to change:** The staging/prod databases are RDS instances accessible only within the VPC. Connecting from a CI runner would require either a socat tunnel pod in K8s or running tests as a K8s Job inside the cluster. Both add complexity and the orphaned-resource risk outweighs the benefit given the existing coverage.

### Remote vitest test exclusions (PR environments)

When vitest runs remotely against a PR environment, two test files are excluded:

- **`full-pipeline.test.ts`** -- Uses `child_process.spawn` to run `workflow-runner` locally and sends SQS messages expecting local consumption. In a PR environment, workflow execution happens in K8s pods, not on the CI runner.
- **`write-contract-workflow.test.ts`** -- Depends on the wallet encryption key matching the exact seeded data. The PR environment seeds wallet data during its deploy pipeline, and the CI runner may not have a compatible key.

The remaining 10 vitest files (114+ tests) run successfully against PR environments via `kubectl port-forward`.

### Admin test API endpoints (TEST_API_KEY)

Playwright tests that need database lookups (OTP codes, invitation IDs) previously required direct DB access, which excluded them from remote runs. Instead of `kubectl port-forward` or VPC tunneling from CI runners, the app exposes two admin API endpoints gated by a `TEST_API_KEY` (`kha_...` prefixed, stored in AWS SSM):

- `GET /api/admin/test/otp?email=xxx` -- Returns the latest OTP for the given email
- `GET /api/admin/test/invitation?email=xxx` -- Returns the pending invitation ID for the given email

Both endpoints validate:
1. `Authorization: Bearer <TEST_API_KEY>` via timing-safe comparison
2. Email must end with `@techops.services`

The Playwright test utils (`getOtpFromDb`, `getInvitationIdFromDb`) automatically use these endpoints when `TEST_API_KEY` + `BASE_URL` are both set (remote mode), falling back to direct DB queries for local/ephemeral runs. This eliminates the need for `--grep-invert` exclusions on invitation and wallet tests.

### Remote Playwright exclusions (remaining)

Only `happy-paths` tests are excluded from remote Playwright runs via `--grep-invert`. These are long-running integration scenarios that require local infrastructure (SQS, workflow-runner).

### Preflight checks

Playwright's `global-setup.ts` runs preflight validation before any tests execute:

- **Remote mode** (`BASE_URL` set): Validates `TEST_API_KEY` is present. Fails fast if missing. Skips DB seeding (deployed environments manage their own state).
- **Ephemeral mode** (no `BASE_URL`): Validates/defaults `DATABASE_URL`. Runs full cleanup + seed cycle.

### Naming convention

| Job name | Where | What |
|---|---|---|
| `e2e-vitest-ephemeral` | `e2e-tests-ephemeral.yml` | Vitest against ephemeral CI postgres + localstack |
| `e2e-playwright-ephemeral` | `e2e-tests-ephemeral.yml` | Playwright against ephemeral CI app (sharded) |
| `e2e-vitest-remote` | `deploy-pr-environment.yaml` | Vitest against deployed PR env via kubectl port-forward |
| `e2e-playwright-remote` | `deploy-pr-environment.yaml`, `deploy-keeperhub.yaml` | Playwright against deployed env via admin API |

---

## Test Data and Seeding

### Persistent Test Users

Five test users are seeded before every Playwright run by `global-setup.ts`. They are created via direct SQL inserts (not the app's signup flow) and persist across test files. Passwords are hashed with scrypt (compatible with Better Auth).

| Email | Password | Org Slug | Role | Purpose |
|---|---|---|---|---|
| `pr-test-do-not-delete@techops.services` | `TestPassword123!` | `e2e-test-org` | owner | Primary test user, wallet holder |
| `pr-test-inviter@techops.services` | `TestPassword123!` | `e2e-test-inviter-org` | owner | Invitation sender tests |
| `pr-test-member@techops.services` | `TestPassword123!` | `e2e-test-member-org` | owner | Also a member of `e2e-test-inviter-org` |
| `pr-test-bystander@techops.services` | `TestPassword123!` | `e2e-test-bystander-org` | owner | Non-participant in shared org tests |
| `test-analytics@techops.services` | `TestAnalytics123!` | `e2e-test-analytics-org` | owner | Analytics dashboard testing |

The analytics user also gets seed data: 3 workflows, 30 workflow executions (with step logs), 40 direct executions, and a 0.05 ETH spend cap.

**Source:** `tests/e2e/playwright/utils/seed.ts`

### Ephemeral Test Users

Playwright signup tests create ephemeral users matching `test+*@techops.services`. These are cleaned up at the start of each test run by `cleanupTestUsers()`. The persistent `pr-test-do-not-delete@techops.services` user is explicitly protected from cleanup.

**Source:** `tests/e2e/playwright/utils/cleanup.ts`

### Seed Lifecycle

The Playwright global setup (`tests/e2e/playwright/global-setup.ts`) runs this sequence before all tests:

1. `cleanupTestUsers()` -- delete ephemeral `test+*@techops.services` users and all their data
2. `cleanupPersistentTestUsers()` -- delete data owned by persistent users (workflows, executions, wallets) but keep the users themselves
3. `seedPersistentTestUsers()` -- recreate the 5 persistent users and their orgs (idempotent)
4. `seedAnalyticsData()` -- create analytics seed workflows and executions

Cleanup follows FK-safe deletion order: execution logs -> executions -> schedules -> workflows -> para wallets -> integrations -> API keys -> invitations -> members -> sessions -> accounts -> organizations -> users -> verifications.

### Vitest Seed Commands

Vitest E2E tests rely on seed scripts run before the test suite (in CI, these run as workflow steps):

```bash
pnpm db:setup-workflow   # Create workflow-specific tables
pnpm db:migrate          # Run all migrations
pnpm db:seed             # Seed chains and tokens
pnpm db:seed-test-wallet # Create persistent test user + org + Para wallet
```

---

## Para Wallet

A single pre-provisioned Para wallet is used for all write-contract tests. It is shared with keeper-app (same Para project).

| Property | Value |
|---|---|
| Wallet ID | `3b1acc96-170f-4148-800b-7bca3e2ee6ad` |
| Wallet Address | `0x4f1089424dcf25b1290631df483a436b320e51a1` |
| Owner | `pr-test-do-not-delete@techops.services` / `e2e-test-org` |
| Encryption | AES-256-GCM (iv:authTag:ciphertext format) |

The wallet is **not** created dynamically via the Para API. The wallet ID and address are hardcoded in the seed script. At seed time, the raw Para user share (`TEST_PARA_USER_SHARE`) is encrypted with `WALLET_ENCRYPTION_KEY` and stored in the `para_wallets` table.

**Seed script:** `scripts/seed/seed-test-wallet.ts`
**Encryption:** `keeperhub/lib/encryption.ts` -- `encryptUserShare()` / `decryptUserShare()`

### Safety Guards

The seed script refuses to run against production databases:
- Blocks if `NODE_ENV=production` (unless `ALLOW_SEED_TEST_WALLET=true`)
- Blocks if `DATABASE_URL` host is not `localhost`, `127.0.0.1`, `*.svc.cluster.local`, or `*.internal` (unless `ALLOW_SEED_TEST_WALLET=true`)

---

## Sepolia Testnet

### Test Contract

The `write-contract-workflow.test.ts` test interacts with a SimpleStorage contract on Sepolia:

| Property | Value |
|---|---|
| Contract | `0x069d34E130ccA7D435351FB30c0e97F2Ce6B42Ad` |
| Chain ID | `11155111` (Sepolia) |
| Function | `store(uint256)` -- writes a random value, then reads it back to verify |

This test validates the full write-contract step: wallet signing via Para SDK, gas estimation, transaction submission, and on-chain state verification.

### Wallet Funding

The test wallet needs Sepolia ETH to pay gas. A funding script tops it up from a funder EOA:

```bash
pnpm db:fund-test-wallet
```

| Parameter | Value |
|---|---|
| Funding amount | 0.002 ETH per run |
| Minimum balance threshold | 0.001 ETH (skips funding if wallet already has enough) |
| Funder key | `TESTNET_FUNDER_PK` env var (private key of a funded Sepolia EOA) |
| RPC | Looked up from the `chains` table (Sepolia entry, seeded by `pnpm db:seed-chains`) |

**Source:** `scripts/miscellaneous/fund-test-wallet.ts`

The funder wallet needs to be periodically topped up via a Sepolia faucet. If the funder runs dry, `write-contract-workflow.test.ts` will fail with "insufficient funds".

### RPC Configuration

Tests use public RPC endpoints by default (no API keys required). RPCs are resolved in this priority order:

1. `CHAIN_RPC_CONFIG` JSON env var (from AWS Parameter Store in deployed environments)
2. Individual env vars (e.g., `CHAIN_SEPOLIA_PRIMARY_RPC`)
3. Public defaults (hardcoded in `lib/rpc/rpc-config.ts`)

Default public RPCs used by tests:

| Network | Chain ID | Default RPC |
|---|---|---|
| Ethereum | 1 | `https://eth.llamarpc.com` |
| Sepolia | 11155111 | `https://ethereum-sepolia-rpc.publicnode.com` |
| Base | 8453 | `https://mainnet.base.org` |
| Base Sepolia | 84532 | `https://sepolia.base.org` |

---

## Secrets Reference

### Required for full test suite

| Secret | Purpose | Used by |
|---|---|---|
| `WALLET_ENCRYPTION_KEY` | 32-byte hex key (64 chars) for AES-256-GCM encryption of Para user shares | Vitest wallet tests, seed script |
| `PARA_API_KEY` | Para SDK API key for transaction signing | `write-contract-workflow.test.ts` |
| `TEST_PARA_USER_SHARE` | Raw Para user share (base64 string) for the test wallet | `pnpm db:seed-test-wallet` |
| `PARA_ENVIRONMENT` | Para SDK environment (always `beta` for tests) | All Para-dependent tests |

### Required for testnet funding

| Secret | Purpose | Used by |
|---|---|---|
| `TESTNET_FUNDER_PK` | Private key of a funded Sepolia EOA | `pnpm db:fund-test-wallet` |

### Required for Para wallet cleanup (Playwright)

| Secret | Purpose | Used by |
|---|---|---|
| `PARA_PORTAL_ORG_ID` | Para Portal organization ID | `cleanupTestUsers()` |
| `PARA_PORTAL_PROJECT_ID` | Para Portal project ID | `cleanupTestUsers()` |
| `PARA_PORTAL_KEY_ID` | Para Portal key ID | `cleanupTestUsers()` |
| `PARA_PORTAL_API_KEY` | Para Portal API key | `cleanupTestUsers()` |

Without the Portal credentials, ephemeral wallets are only deleted from the database (not from Para's API). Persistent wallet cleanup skips the API call regardless.

### Required for deployed PR environment access

| Secret | Purpose | Used by |
|---|---|---|
| `CF_ACCESS_CLIENT_ID` | Cloudflare Access service token | Remote tests against PR environments |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token | Remote tests against PR environments |

### Test defaults (no secret needed)

| Variable | Default | Source |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5433/keeperhub` | `tests/setup.ts` |
| `AWS_ENDPOINT_URL` | `http://localhost:4566` | `tests/setup.ts` |
| `AWS_ACCESS_KEY_ID` | `test` | `tests/setup.ts` |
| `AWS_SECRET_ACCESS_KEY` | `test` | `tests/setup.ts` |
| `SQS_QUEUE_URL` | `http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/keeperhub-workflow-queue` | `tests/setup.ts` |
| `KEEPERHUB_URL` | `http://localhost:3000` | `tests/setup.ts` |

---

## Test Cleanup

### Ephemeral Users

`cleanupTestUsers()` targets users matching `test+*@techops.services` (the pattern Playwright signup tests use). It deletes in FK-safe order:

1. Workflow execution logs, executions, schedules, workflows
2. Para wallets (API deletion via Para Portal if credentials available, then DB rows)
3. Integrations, API keys, RPC preferences
4. Organization-scoped data (direct executions, spend caps, address book, tokens, projects, tags)
5. Invitations (org-owned + email-matched)
6. Members (org-owned + user-owned)
7. Sessions, accounts
8. Organizations
9. Users
10. Verification records (OTP)

The persistent user `pr-test-do-not-delete@techops.services` is explicitly excluded.

### Persistent Users

`cleanupPersistentTestUsers()` deletes **data** owned by persistent users (workflows, executions, wallets, integrations, API keys, org-scoped records) but preserves the users, accounts, memberships, and organizations themselves. This gives each test run a clean slate without re-creating the users from scratch.

### Para Wallet API Cleanup

Ephemeral wallets created during Playwright signup flows are deleted from Para's API via:

```
DELETE /organizations/{orgId}/projects/{projectId}/beta/keys/{keyId}/pregen/{walletId}
```

This requires `PARA_PORTAL_*` env vars. Without them, wallets are only deleted from the database. The persistent test wallet is never deleted from the API (only its DB row is cleaned and re-seeded).

---

## Playwright Auth State

Playwright tests use persistent auth state to avoid signing in for every test. Three auth setup projects run once and store browser state:

| Setup | Storage File | User |
|---|---|---|
| Authenticate as persistent test user | `.auth/user.json` | `pr-test-do-not-delete@techops.services` |
| Authenticate as inviter | `.auth/inviter.json` | `pr-test-inviter@techops.services` |
| Authenticate as bystander | `.auth/bystander.json` | `pr-test-bystander@techops.services` |

Tests that use the "authenticated" project automatically get the persistent test user's session. Tests needing a different user context specify the appropriate auth state file.

**Source:** `tests/e2e/playwright/auth.setup.ts`

---

## Vitest E2E Test Inventory

| Test File | DB | SQS | RPC | Para | What it tests |
|---|---|---|---|---|---|
| `rpc-failover.test.ts` | write | -- | yes | -- | RPC failover and preference resolution |
| `api-key-auth.test.ts` | write | -- | -- | -- | API key authentication and authorization |
| `nonce-manager.test.ts` | write | -- | -- | -- | PG advisory locks, nonce lifecycle |
| `full-pipeline.test.ts` | write | yes | -- | -- | Workflow trigger -> SQS -> runner execution |
| `transaction-flow.test.ts` | write | -- | Sepolia | -- | Nonce sessions, gas strategy, pending txs |
| `schedule-pipeline.test.ts` | write | yes | -- | -- | Cron scheduling, SQS dispatch, execution |
| `workflow-runner.test.ts` | write | -- | -- | -- | Runner subprocess exit codes, DB state |
| `user-rpc-workflow.test.ts` | write | -- | yes | -- | Custom RPC preferences in workflow execution |
| `write-contract-workflow.test.ts` | write | -- | Sepolia | yes | On-chain write via Para wallet signing |
| `graceful-shutdown.test.ts` | write | -- | -- | -- | Signal handling, execution lifecycle |
| `check-balance.test.ts` | -- | -- | yes | -- | Balance checks across EVM + Solana |
| `gas-strategy.test.ts` | -- | -- | yes | -- | Gas estimation across networks |

All DB-dependent tests skip when `DATABASE_URL` is unset or `SKIP_INFRA_TESTS=true`.
