# Multi-stage Dockerfile for the event worker service
# Build context: repo root (for pnpm workspace lockfile access)

# ==============================================================================
# Base stage - common setup
# ==============================================================================
FROM node:22-alpine AS base
RUN npm install -g pnpm
WORKDIR /app

# ==============================================================================
# Dependencies stage - install and deploy production dependencies
# ==============================================================================
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY event-worker/package.json ./event-worker/
COPY event-tracker/package.json ./event-tracker/
COPY event-executor/package.json ./event-executor/

RUN --mount=type=cache,id=pnpm-events,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile && \
    pnpm deploy --legacy --filter @techops/events-worker --prod /app/deploy

# ==============================================================================
# Build stage - install all dependencies for type checking
# ==============================================================================
FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY event-worker/package.json event-worker/tsconfig.json ./event-worker/
COPY event-tracker/package.json ./event-tracker/
COPY event-executor/package.json ./event-executor/
COPY event-worker/src/ ./event-worker/src/

RUN --mount=type=cache,id=pnpm-events,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @techops/events-worker

RUN pnpm --filter @techops/events-worker typecheck

# ==============================================================================
# Runtime stage - minimal production image
# ==============================================================================
FROM node:22-alpine AS runtime

RUN apk add --no-cache tini && \
    npm install -g tsx

RUN addgroup -g 1001 -S events && \
    adduser -S events -u 1001

WORKDIR /app

COPY --from=deps /app/deploy/node_modules ./node_modules
COPY --from=build /app/event-worker/src ./src
COPY --from=build /app/event-worker/package.json ./package.json
COPY --from=build /app/event-worker/tsconfig.json ./tsconfig.json
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json

RUN chown -R events:events /app

USER events

EXPOSE 3010

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["tsx", "src/worker.ts"]
