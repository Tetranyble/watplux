#!/usr/bin/env sh
set -eu
: "${APP_INTERNAL_URL:?APP_INTERNAL_URL is required}"
: "${INTERNAL_WORKER_SECRET:?INTERNAL_WORKER_SECRET is required}"

curl --fail --silent --show-error \
  --max-time 25 \
  -X POST \
  -H "x-internal-worker-secret: ${INTERNAL_WORKER_SECRET}" \
  "${APP_INTERNAL_URL%/}/api/internal/process-webhook-events"
