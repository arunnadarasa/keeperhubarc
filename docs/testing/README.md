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

**PR environments:** Both vitest and playwright run remotely. Vitest gets full database access via `kubectl port-forward` to CloudNativePG (`svc/keeperhub-pr-N-db-rw`) and LocalStack (`svc/localstack`). Playwright runs browser tests against the deployed URL.

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
- **Pre-deploy gate:** `e2e-vitest-local` runs against an isolated database before the deploy is allowed to proceed. This validates all backend logic.
- **Post-deploy verification:** `e2e-playwright-remote` confirms the deployed application is functional end-to-end through the UI.
- **PR environments:** `e2e-vitest-remote` runs with full DB access on PR deploys, where each PR has an isolated CloudNativePG instance. No risk to shared data.

**If this needs to change:** The staging/prod databases are RDS instances accessible only within the VPC. Connecting from a CI runner would require either a socat tunnel pod in K8s or running tests as a K8s Job inside the cluster. Both add complexity and the orphaned-resource risk outweighs the benefit given the existing coverage.
