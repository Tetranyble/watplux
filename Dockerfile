# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.23.1

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts/prepare-cpanel-runtime.mjs ./scripts/prepare-cpanel-runtime.mjs
RUN npm ci

# Next.js Cache Components can execute cached server reads while building.
# The build database MUST therefore be an ephemeral, migrated database with no
# production/customer data. CI supplies BUILD_DATABASE_URL and builds with
# --network=host so the build can reach the disposable MySQL service.
FROM deps AS builder
ARG BUILD_DATABASE_URL="mysql://watplux:watplux@127.0.0.1:3306/watplux"
ENV DATABASE_URL=${BUILD_DATABASE_URL} \
    NODE_ENV=production \
    DEPLOYMENT_ENV=build \
    LOG_LEVEL=warn \
    BETTER_AUTH_URL=http://127.0.0.1:3000 \
    APP_BASE_URL=http://127.0.0.1:3000 \
    MEDIA_STORAGE_PROVIDER=local
COPY . .
RUN npm run build

# One-shot release image. Run exactly once before rolling out the application
# image. It intentionally contains Prisma CLI/dev dependencies; the web runtime
# below does not.
FROM deps AS migrator
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY prisma ./prisma
COPY scripts ./scripts
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ARG APP_VERSION=0.1.0
ARG GIT_SHA=unknown
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="Watplux" \
      org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.revision=${GIT_SHA}

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p /app/.next/cache /tmp \
    && chown -R nextjs:nodejs /app/.next/cache /tmp

USER nextjs
EXPOSE 3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
