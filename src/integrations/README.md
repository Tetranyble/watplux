# Integrations

Thin, typed clients for external services — Paystack, object storage,
transactional SMTP email, and optional Termii SMS. No business logic lives
here (see `docs/ARCHITECTURE.md` §1).

Authentication verification/reset emails and service-request acknowledgements
use the email adapter. Termii is an optional second acknowledgement channel;
missing Termii configuration disables SMS without disabling email or request
creation.

The ESLint import-boundary rule (`eslint.config.mjs`) already treats
`src/integrations/**` as its own element type, so a real integration added
later is bound by the same rules (may import `lib`, may not import
`app/**` or another module's `repo.ts`) without further config changes.
