# syntax=docker/dockerfile:1.7
# ── Enterprise IT Service Desk — multi-stage image (Azure App Service / Container Apps ready)

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

# One-shot job: apply migrations (non-destructive) and idempotent seed.
FROM builder AS migrator
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm db:seed"]

# Production dependencies only (Next.js + Socket.IO custom server).
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prod && pnpm prisma generate

FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && groupadd --system app && useradd --system --gid app --home /app app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 STORAGE_LOCAL_DIR=/app/storage
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/package.json /app/next.config.ts ./
RUN mkdir -p /app/storage && chown app:app /app/storage
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Custom server: Next.js + Socket.IO (realtime) on one port. Behind a proxy, enable WebSocket upgrades.
CMD ["node", "dist/server.js"]
