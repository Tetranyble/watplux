#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_root="${1:?Pass the staged cPanel runtime directory}"
linux_install="$(mktemp -d)"

cleanup() {
  rm -rf "$linux_install"
}
trap cleanup EXIT

cp "$project_root/package.json" "$project_root/package-lock.json" "$linux_install/"

echo "Installing locked Linux x64 production dependencies for cPanel..."
(
  cd "$linux_install"
  npm ci \
    --omit=dev \
    --include=optional \
    --ignore-scripts \
    --no-audit \
    --no-fund \
    --os=linux \
    --cpu=x64
)

copy_package() {
  local package_path="$1"
  local source="$linux_install/node_modules/$package_path"
  local destination="$runtime_root/node_modules/$package_path"

  if [[ ! -d "$source" ]]; then
    echo "Linux dependency staging failed: $package_path was not installed."
    exit 1
  fi

  mkdir -p "$(dirname "$destination")"
  rsync -a --delete "$source/" "$destination/"
}

for package_path in \
  sharp \
  @img/colour \
  @img/sharp-linux-x64 \
  @img/sharp-libvips-linux-x64 \
  detect-libc \
  semver \
  @node-rs/argon2 \
  @node-rs/argon2-linux-x64-gnu; do
  copy_package "$package_path"
done

echo "Linux x64 Sharp and Argon2 dependencies staged."
