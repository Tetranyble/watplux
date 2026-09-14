# Watplux deployment reference

Production deploys an external managed MySQL database plus immutable application containers. Do not use the root development `docker-compose.yml` as production database infrastructure.

## Files

- `compose.production.yml` — reference single-host container deployment for the web app + webhook scheduler.
- `.env.production.example` — application runtime variables (copy outside source control as `.env.production`).
- `.env.worker.example` — least-privilege worker scheduler secret only.
- `nginx/watplux.conf` — optional reverse-proxy reference; most importantly it overwrites `X-Real-IP` so Phase 15 rate limiting never trusts a client-supplied address.
- `cron/webhook-worker.cron` — reference for platforms using system cron instead of the compose scheduler.

Before a release, use the runbooks under `docs/operations/`. Prefer a platform-native load balancer/scheduler/secret manager over these reference files when available; preserve the same security and sequencing invariants.
