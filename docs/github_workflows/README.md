# GitHub Workflows

## Workflow Types

Every workflow file in `.github/workflows/` is one of three types, indicated by a comment header:

```yaml
# Type: orchestrator | Coordinates e2e-tests-ephemeral -> deploy
```

```yaml
# Type: reusable | Called by ci-pipeline.yml
```

Workflows without a type header are **standalone** -- they trigger and run independently.

| Type | Purpose | Trigger |
|------|---------|---------|
| **Orchestrator** | Defines a pipeline by calling reusable workflows in sequence | `push`, `pull_request` |
| **Reusable** | Self-contained unit of work, called via `workflow_call` | `workflow_call`, optionally `workflow_dispatch` |
| **Standalone** | Independent workflow, not part of a pipeline | Varies (`push`, `pull_request`, `schedule`) |

## Pipelines

### CI Pipeline

**File:** `ci-pipeline.yml` (orchestrator)

Triggered on push to `staging`/`prod` or PR with `run-e2e-tests-ephemeral` label.

```
ci-pipeline.yml
  |
  +-- e2e-tests-ephemeral.yml  (E2E tests: Vitest + Playwright)
  |
  +-- deploy-keeperhub.yaml    (Build, push to ECR, deploy via Helm)
       ^^ only on push, skipped for PRs
```

- Deploy only runs if E2E tests succeed (`needs: e2e-tests`)
- `[skip e2e]` in commit message skips E2E tests (and therefore deploy)
- `[skip build]` / `[skip deploy]` in commit message skips those stages within deploy

### Release Pipeline

**File:** `release-pipeline.yml` (orchestrator)

Triggered on push to `prod` only.

```
release-pipeline.yml
  |
  +-- release.yml    (Tag, generate release notes, notify Discord)
  |
  +-- docs-sync.yml  (Detect code changes, update docs via Claude Code)
       ^^ only runs if release succeeds
```

## All Workflows

### Orchestrators

| File | Pipeline | Triggers |
|------|----------|----------|
| `ci-pipeline.yml` | E2E -> Deploy | Push to staging/prod, PR with label |
| `release-pipeline.yml` | Release -> Docs Sync | Push to prod |

### Reusable

| File | Called By | Also supports |
|------|-----------|---------------|
| `e2e-tests-ephemeral.yml` | `ci-pipeline.yml` | `workflow_dispatch` |
| `deploy-keeperhub.yaml` | `ci-pipeline.yml` | `workflow_dispatch` |
| `release.yml` | `release-pipeline.yml` | -- |
| `docs-sync.yml` | `release-pipeline.yml` | `workflow_dispatch` (with `days_back` input) |

### Standalone

| File | Purpose | Triggers |
|------|---------|----------|
| `deploy-docs.yaml` | Deploy documentation site | Push to staging/prod |
| `deploy-pr-environment.yaml` | Deploy ephemeral PR environment | PR opened/synced/labeled |
| `cleanup-pr-environment.yaml` | Tear down PR environment | PR closed/unlabeled |
| `pr-checks.yml` | Lint, type-check, build | PR to any branch |
| `pr-title-check.yml` | Enforce conventional commit PR titles | PR opened/edited/synced |
| `maintainability.yml` | Code quality metrics | PR to staging |
| `keeperhub-daily-main-sync-with-upstream.yml` | Sync fork with upstream template | Daily cron |
| `keeperhub-daily-merge-staging.yml` | Merge staging into main | Daily cron |

## Composite Actions

| Action | Path | Purpose |
|--------|------|---------|
| `setup-node-pnpm` | `.github/actions/setup-node-pnpm/action.yml` | Installs Node.js 22, pnpm 9, caches dependencies, optionally installs Playwright browsers and runs plugin discovery |

### `setup-node-pnpm` Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `install-playwright` | `"false"` | Install and cache Playwright Chromium browsers |
| `discover-plugins` | `"false"` | Run `pnpm discover-plugins` after install |

Used by: `e2e-tests-ephemeral.yml`, `deploy-keeperhub.yaml`, `deploy-pr-environment.yaml`

## Design Decisions

### Why orchestrators instead of `workflow_run`?

Workflows triggered by `workflow_run` execute in the default branch context. This means they appear branchless in the GitHub Actions UI and require fallback expressions like `github.event.workflow_run.head_branch || github.ref_name` throughout.

With `workflow_call`, the reusable workflow inherits the caller's branch context (`github.ref_name`, `github.sha`), so runs display correctly and expressions are simpler.

### `github.event_name` in reusable workflows

`github.event_name` is always `workflow_call` inside a reusable workflow -- it does **not** inherit the caller's event name. To preserve event-specific logic (e.g., checking for PR labels vs. commit message flags), orchestrators pass the original event name via the `caller_event` input.
