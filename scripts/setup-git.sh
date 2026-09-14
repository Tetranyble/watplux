#!/bin/sh
set -eu

REMOTE_URL="${1:-}"

if [ ! -d .git ]; then
  git init -b main
fi

git config core.hooksPath .githooks
git config pull.ff only

git check-ignore .env >/dev/null 2>&1 || {
  echo '.env is not ignored; refusing to continue.' >&2
  exit 1
}

if [ -n "$REMOTE_URL" ]; then
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$REMOTE_URL"
  else
    git remote add origin "$REMOTE_URL"
  fi
fi

printf '%s\n' 'Git setup complete.'
printf '%s\n' 'Branch: main'
printf '%s\n' 'Hooks: .githooks'
if [ -n "$REMOTE_URL" ]; then
  printf 'Origin: %s\n' "$REMOTE_URL"
else
  printf '%s\n' 'Origin: not configured (pass the repository URL as the first argument).'
fi
printf '%s\n' 'Next: npm install, review package-lock.json, git add ., git commit, then push.'
