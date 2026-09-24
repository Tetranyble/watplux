#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

export NODE_ENV=production
export DEPLOYMENT_ENV=build
export LOG_LEVEL=warn
export APP_VERSION="$(node -p "require('./package.json').version")"
export GIT_SHA="$(git rev-parse --short=12 HEAD)"
export BETTER_AUTH_SECRET=build-only-secret-that-is-never-deployed
export MEDIA_STORAGE_PROVIDER=local
unset PAYSTACK_SECRET_KEY INTERNAL_WORKER_SECRET GUEST_ORDER_TOKEN_SECRET
unset S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
unset SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD SEED_ADMIN_NAME

echo "Running source and architecture checks..."
npm run audit:lockfile
npm run audit:ui
npm run audit:release
npm run typecheck
npm run lint
npm run format:check
npm test

echo "Generating Prisma Client with cPanel Linux engine targets..."
npm run db:generate

echo "Building the standalone production runtime with webpack..."
# Keep the regular `npm run build` path unchanged. The cPanel packager stages
# locked Linux x64 native modules into the standalone runtime, and
# Turbopack's hashed external package aliases (for example
# @prisma/client-<hash>) are not portable.
npx next build --webpack

exec bash scripts/package-cpanel.sh
