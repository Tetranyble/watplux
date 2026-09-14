# Integrations

Thin, typed clients for external services — Paystack, object storage, email.
No business logic lives here (see `docs/ARCHITECTURE.md` §1).

Empty in Phase 1 by design: no external integrations are implemented until
their owning phase (Paystack in Phase 9, storage in Phase 4/13, email
notifications alongside the phases that trigger them).

The ESLint import-boundary rule (`eslint.config.mjs`) already treats
`src/integrations/**` as its own element type, so a real integration added
later is bound by the same rules (may import `lib`, may not import
`app/**` or another module's `repo.ts`) without further config changes.
