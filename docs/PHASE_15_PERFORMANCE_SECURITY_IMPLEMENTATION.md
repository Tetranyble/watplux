# Phase 15 — Performance & Security Hardening

Status: SOURCE IMPLEMENTED — FULL RUNTIME VERIFICATION PENDING

## Decisions

### Authentication and abuse controls
Better Auth remains the authentication owner. Its built-in rate limiter is now explicitly enabled outside tests, with database storage and stricter rules for credential endpoints. The Prisma `RateLimit` model exists solely to satisfy Better Auth's persistence contract.

Watplux public business endpoints use a separate database-backed `RequestRateLimit` abstraction. This keeps business HTTP abuse policy independent of Better Auth internals. Consultation/installation submissions and checkout creation are limited today; the abstraction is reusable for later public mutations.

Client identity is accepted from one configured trusted-proxy header only. Production ingress must overwrite that header. `x-real-ip` is the safe default; `x-forwarded-for` is available only for infrastructure that normalizes it.

### Security headers
Global CSP, frame denial, MIME sniff protection, referrer policy, permissions policy, COOP, origin isolation, disabled DNS prefetch, hidden `X-Powered-By`, and production HSTS are configured in `next.config.ts`. Account and admin paths explicitly receive private/no-store caching directives.

The CSP intentionally permits inline scripts/styles because Next.js currently emits framework bootstrap/style content that would otherwise require request-scoped nonce plumbing. It still denies objects, frames, foreign forms and foreign connections. A nonce-based CSP can be evaluated later against measured caching/PPR impact rather than introduced blindly.

### Redirects and machine secrets
Post-login redirects now pass through `safeInternalPath`, rejecting absolute, protocol-relative, encoded protocol-relative and backslash forms. Internal worker secret comparison is constant-time.

### Request-body limits
Paystack webhook ingestion now stream-reads with a 256 KiB hard cap. This protects the durable-inbox endpoint from oversized/chunked request memory abuse before JSON parsing or database insertion.

### Webhook worker health
The existing claim/retry/staleness model now exposes a machine-authenticated GET health snapshot on `/api/internal/process-webhook-events`. It reports pending, processing, stale-processing, failed, exhausted, and oldest-pending state and returns 503 when degraded.

### Query/index review
Phase 15 adds supporting indexes for observed critical paths rather than generic indexing:
- default-variant price ordering used by storefront price sort;
- generated available inventory used by stock-aware discovery;
- customer and assignee service-request queues;
- webhook status/received-time monitoring.

LIKE `%term%` catalog search is intentionally not "fixed" with ineffective B-tree indexes. Phase 13's bounded search stays until real catalog volume/query plans justify FULLTEXT or a dedicated search engine.

## Migration
`20260831011500_phase15_security_performance` adds the two rate-limit tables and the critical-path indexes. This is acceptable pre-launch and should be applied before runtime testing.

## Verification gate
Run against real MySQL after dependencies are installable:

```bash
npm install
npm run db:generate
npx prisma migrate dev
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:integration
npm run test:e2e
npm run build
```

Then perform browser Lighthouse/Web Vitals measurements. Those measurements are not fabricated in source-only validation.
