# Stage 1: Dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-scheduler,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Stage 2: Dispatcher
FROM node:22-alpine AS dispatcher
WORKDIR /app
RUN npm install -g tsx
COPY --from=deps /app/node_modules ./node_modules
COPY schedule-dispatcher/ ./schedule-dispatcher/
COPY lib/ ./lib/
COPY package.json tsconfig.json ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["tsx", "schedule-dispatcher/index.ts"]

# Stage 3: Executor
FROM node:22-alpine AS executor
WORKDIR /app
RUN npm install -g tsx
COPY --from=deps /app/node_modules ./node_modules
COPY schedule-executor/ ./schedule-executor/
COPY lib/ ./lib/
COPY package.json tsconfig.json ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["tsx", "schedule-executor/index.ts"]

# Stage 4: Block Dispatcher
FROM node:22-alpine AS block-dispatcher
WORKDIR /app
RUN npm install -g tsx
COPY --from=deps /app/node_modules ./node_modules
COPY block-dispatcher/ ./block-dispatcher/
COPY lib/ ./lib/
COPY package.json tsconfig.json ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["tsx", "block-dispatcher/index.ts"]
