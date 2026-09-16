#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

: "${BUILD_DATABASE_URL:?BUILD_DATABASE_URL must point to an empty disposable MySQL build database}"
: "${CPANEL_APP_URL:?CPANEL_APP_URL must be the public HTTPS origin, for example https://watplux.example}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to build a dirty working tree. Commit the cPanel release first."
  exit 1
fi

if [[ "${CONFIRM_DISPOSABLE_BUILD_DATABASE:-}" != "yes" ]]; then
  echo "Refusing to build: set CONFIRM_DISPOSABLE_BUILD_DATABASE=yes after verifying BUILD_DATABASE_URL contains no production or customer data."
  exit 1
fi

if [[ "$CPANEL_APP_URL" != https://* ]]; then
  echo "CPANEL_APP_URL must use https://"
  exit 1
fi

if [[ -n "${DATABASE_URL:-}" && "$BUILD_DATABASE_URL" == "$DATABASE_URL" ]]; then
  echo "BUILD_DATABASE_URL must not be the configured runtime DATABASE_URL."
  exit 1
fi

export DATABASE_URL="$BUILD_DATABASE_URL"
export NODE_ENV=production
export DEPLOYMENT_ENV=build
export LOG_LEVEL=warn
export APP_VERSION="$(node -p "require('./package.json').version")"
export GIT_SHA="$(git rev-parse --short=12 HEAD)"
export BETTER_AUTH_SECRET=build-only-secret-that-is-never-deployed
export BETTER_AUTH_URL="$CPANEL_APP_URL"
export APP_BASE_URL="$CPANEL_APP_URL"
export MEDIA_STORAGE_PROVIDER=local
unset PAYSTACK_SECRET_KEY INTERNAL_WORKER_SECRET GUEST_ORDER_TOKEN_SECRET
unset S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY SEED_ADMIN_PASSWORD

echo "Running source and architecture checks..."
npm run audit:lockfile
npm run audit:ui
npm run audit:release
npm run typecheck
npm run lint
npm run format:check
npm test

echo "Migrating the disposable build database..."
npm run db:migrate:deploy

echo "Building the standalone production runtime with webpack..."
# Keep the regular `npm run build` path unchanged. The cPanel archive replaces
# native modules with Linux-built copies from the application root, and
# Turbopack's hashed external package aliases (for example
# @prisma/client-<hash>) cannot be recreated by `npm ci` on the server.
npx next build --webpack

exec bash scripts/package-cpanel.sh
