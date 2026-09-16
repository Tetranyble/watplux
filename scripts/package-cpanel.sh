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

for command in git rsync zip; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required to package the cPanel release."
    exit 1
  fi
done

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to package a dirty working tree. Commit the release first."
  exit 1
fi

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
cp -R prisma scripts src lib "$stage_dir/app/"

# Native modules built on the developer machine are not portable to cPanel's
# Linux host. They are intentionally resolved from the application-root
# node_modules installed on cPanel with Node 22 instead.
rsync -a \
  --exclude 'node_modules/sharp' \
  --exclude 'node_modules/@img' \
  --exclude 'node_modules/@node-rs/argon2*' \
  --exclude 'node_modules/@prisma/client' \
  --exclude 'node_modules/@prisma/engines' \
  --exclude 'node_modules/.prisma' \
  .next/standalone/ "$stage_dir/app/runtime/"
rsync -a --delete public/ "$stage_dir/app/runtime/public/"
rsync -a --delete .next/static/ "$stage_dir/app/runtime/.next/static/"

printf '%s\n' "$release_sha" > "$stage_dir/app/RELEASE_SHA"

for required in \
  runtime/server.js \
  runtime/.next/BUILD_ID \
  runtime/.next/server/webpack-runtime.js \
  runtime/node_modules/next/dist/compiled/cookie/index.js \
  runtime/public/web-app-manifest-192x192.png \
  package-lock.json \
  prisma/schema.prisma \
  server.js; do
  if [[ ! -f "$stage_dir/app/$required" ]]; then
    echo "Packaged cPanel runtime is missing $required"
    exit 1
  fi
done

rm -f "$artifact_path"
(
  cd "$stage_dir/app"
  zip -qry "$artifact_path" .
)

echo "Created $artifact_path"
du -h "$artifact_path"
