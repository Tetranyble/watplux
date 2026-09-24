#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_sha="$(git -C "$project_root" rev-parse --short=12 HEAD)"
artifact_dir="$project_root/release/cpanel"
artifact_path="$artifact_dir/watplux-cpanel-$release_sha.zip"
stage_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

cd "$project_root"

for command in git npm rsync zip; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required to package the cPanel release."
    exit 1
  fi
done

if [[ ! -f .next/standalone/server.js || ! -f .next/standalone/.next/BUILD_ID ]]; then
  echo "No standalone production build found. Run npm run build:cpanel."
  exit 1
fi

if [[ ! -f .next/standalone/.next/server/webpack-runtime.js ]]; then
  echo "The standalone runtime is not the required cPanel webpack build."
  echo "Run npm run build:cpanel before packaging."
  exit 1
fi

# A Turbopack standalone build can refer to synthetic external packages such
# as @prisma/client-<hash>. Those packages do not exist in the npm registry and
# fail after deployment when native dependencies are installed on Linux.
if LC_ALL=C grep -R -E -q \
  --include='*.js' \
  'require\("@prisma/client-[[:xdigit:]]{8,}"\)' \
  .next/standalone/.next/server; then
  echo "Refusing to package a Turbopack runtime with a hashed Prisma external."
  echo "Run npm run build:cpanel so the cPanel-specific webpack build is used."
  exit 1
fi

mkdir -p "$artifact_dir" "$stage_dir/app/runtime/.next"

for file in package.json package-lock.json .nvmrc server.js tsconfig.json; do
  cp "$file" "$stage_dir/app/$file"
done

cp deploy/.env.cpanel.example "$stage_dir/app/.env.production.example"
cp deploy/cpanel-cron.example "$stage_dir/app/cpanel-cron.example"
cp -R prisma scripts src lib "$stage_dir/app/"

# Native modules built on the developer machine are not portable to cPanel's
# Linux host. Exclude them from the traced macOS runtime; Linux x64 copies are
# staged below so the shared host never has to install application packages.
rsync -a \
  --exclude 'node_modules/sharp' \
  --exclude 'node_modules/@img' \
  --exclude 'node_modules/@node-rs/argon2*' \
  --exclude 'node_modules/@prisma/engines' \
  --exclude 'node_modules/.prisma/client/libquery_engine-darwin*' \
  .next/standalone/ "$stage_dir/app/runtime/"
rsync -a --delete public/ "$stage_dir/app/runtime/public/"
rsync -a --delete .next/static/ "$stage_dir/app/runtime/.next/static/"

# Prisma's generated client and every selected Linux query engine are copied
# explicitly because its runtime engine selection is dynamic and cannot be
# trusted to survive generic output-file tracing.
mkdir -p \
  "$stage_dir/app/runtime/node_modules/@prisma/client" \
  "$stage_dir/app/runtime/node_modules/.prisma/client"
rsync -a --delete \
  node_modules/@prisma/client/ \
  "$stage_dir/app/runtime/node_modules/@prisma/client/"
rsync -a --delete \
  --exclude 'libquery_engine-darwin*' \
  node_modules/.prisma/client/ \
  "$stage_dir/app/runtime/node_modules/.prisma/client/"

bash scripts/stage-cpanel-linux-dependencies.sh "$stage_dir/app/runtime"

printf '%s\n' "$release_sha" > "$stage_dir/app/RELEASE_SHA"

for required in \
  runtime/server.js \
  runtime/.next/BUILD_ID \
  runtime/.next/server/webpack-runtime.js \
  runtime/node_modules/next/dist/compiled/cookie/index.js \
  runtime/node_modules/@prisma/client/index.js \
  runtime/node_modules/.prisma/client/default.js \
  runtime/node_modules/.prisma/client/libquery_engine-debian-openssl-1.0.x.so.node \
  runtime/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node \
  runtime/node_modules/@node-rs/argon2-linux-x64-gnu/argon2.linux-x64-gnu.node \
  runtime/public/web-app-manifest-192x192.png \
  package-lock.json \
  cpanel-cron.example \
  prisma/schema.prisma \
  scripts/prepare-cpanel-runtime.mjs \
  scripts/stage-cpanel-linux-dependencies.sh \
  server.js; do
  if [[ ! -f "$stage_dir/app/$required" ]]; then
    echo "Packaged cPanel runtime is missing $required"
    exit 1
  fi
done

# Sharp 0.35 includes its version in the native add-on filename (for example
# sharp-linux-x64-0.35.4.node). Keep this check version-agnostic so future
# patch upgrades do not break packaging when the locked binary is present.
if ! compgen -G \
  "$stage_dir/app/runtime/node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64-*.node" \
  >/dev/null; then
  echo "Packaged cPanel runtime is missing the Sharp Linux x64 native add-on"
  exit 1
fi

rm -f "$artifact_path"
(
  cd "$stage_dir/app"
  zip -qry "$artifact_path" .
)

echo "Created $artifact_path"
du -h "$artifact_path"
