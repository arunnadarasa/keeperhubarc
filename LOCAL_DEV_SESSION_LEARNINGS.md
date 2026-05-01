# Local development session learnings

Notes from iterative work on running the KeeperHub Next.js app locally: what worked, what failed, and practices worth keeping.

## Successes

- **`pnpm dev` boot sequence**: The script runs `discover-plugins` (regenerates plugin and protocol registry), `copy-monaco` (copies Monaco assets into `public/monaco/vs`), then `next dev`. First startup can take longer while Turbopack compiles; the server reports `Ready in ... ms` when listening.
- **Non-default port**: Binding the dev server to port **3001** is done by adding `-p 3001` to the `next dev` invocation in `package.json` (and the same for `dev:webpack` if you use it). One-line change, reproducible for the whole team.
- **Clear failure mode**: When a second instance failed, Next.js printed an explicit message naming the existing process (PID), port, project directory, and log path. That made root cause obvious without guessing.

## Failures and how they showed up

1. **Stopping the first dev server when changing port**  
   The initial server was started on the default port. Starting a new process after editing `package.json` left the old process running until it was stopped. Expect the prior terminal job to show as aborted when you replace it; that is normal if you intentionally killed the process.

2. **Exit code 1: “Another next dev server is already running”**  
   A dev server was still bound (for example on port 3000) while a second `pnpm dev` was started on 3001. Next.js enforces a single dev server per project directory and exits instead of stacking instances.  
   **Fix**: Ensure only one `pnpm dev` for this repo. Stop the other process (using the PID from the error message, or by freeing the port), then start again.

3. **Environment URL mismatch risk**  
   If `BETTER_AUTH_URL` (or similar) still points at `http://localhost:3000` while the app listens on 3001, auth redirects and callbacks can break. After changing the dev port, align `.env` and any docs or scripts that hardcode the old URL.

## Warnings observed (non-fatal)

- Next.js may warn that `eslint` in `next.config` is no longer supported; follow current Next.js docs for lint integration.
- Turbopack may warn about **multiple lockfiles** (for example a `package-lock.json` above the project and `pnpm-workspace.yaml` in the repo). Setting `turbopack.root` in Next config or removing stray lockfiles can silence incorrect workspace root inference.

## Best practices

- **Single dev server**: Before starting `pnpm dev`, confirm no leftover Next process is serving this tree (`lsof` on the ports you use, or rely on Next’s duplicate-server error).
- **Port changes**: Update `package.json`, then `.env` (`BETTER_AUTH_URL`, anything else that embeds the origin), and team-facing runbooks so they stay consistent.
- **Background tasks**: Long-running commands belong in a dedicated terminal; stopping or replacing them deliberately avoids zombie servers and confusing abort statuses.
- **Repository hygiene**: When pushing documentation-only updates to a fork or separate remote, commit only the intended files so unrelated local edits do not travel with the push.

## Commands reference

```bash
pnpm dev              # Start dev server (uses port from package.json if -p is set)
pnpm dev -- -p 3001   # One-off port without editing package.json (if script passes args through)
```

## Related project docs

- `AGENTS.md` and `CLAUDE.md` in this repo for lint, type-check, and workflow conventions.
- Upstream README sections on prerequisites (Node 22, pnpm, PostgreSQL) and env setup.
