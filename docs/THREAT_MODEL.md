# Watplux Threat Model

This is the release-candidate threat model established in Phase 18. It is deliberately scoped to Watplux's current architecture rather than a generic web-security checklist.

## Assets

Customer accounts/sessions; RBAC assignments; customer contact/address data; catalog and inventory state; order/payment/refund state; Paystack webhook history; media objects; audit history; production secrets; database backups.

## Actors

Anonymous visitor, guest shopper, authenticated customer, staff, super admin, Paystack, internal scheduler/worker, infrastructure operator, and an external attacker who may also possess a normal customer account.

## Trust boundaries and controls

| Boundary | Main threats | Current controls |
| --- | --- | --- |
| Browser -> application | credential stuffing, IDOR, forged fields, stock abuse, XSS | Better Auth, DB rate limiting, server actor resolution, use-case authorization, Zod validation, CSP/security headers, Checkout-only order entry |
| Proxy -> application | IP spoofing/rate-limit bypass | deployment-controlled trusted client-IP header; ingress must overwrite it |
| Application -> MySQL | injection, race conditions, inconsistent financial/stock state | Prisma parameterization, transactions, guarded updates, uniqueness constraints, append-only inventory movements |
| Application -> Paystack | secret leakage, network/API ambiguity | server-only key, typed integration adapter, sanitized failures, no card data handled by Watplux |
| Paystack -> webhook | forged/replayed/oversized events | HMAC verification, body cap, natural-key dedupe, durable inbox, idempotent state transitions |
| Scheduler -> worker | unauthorized processing trigger | independent internal secret and constant-time comparison; no browser-session fallback |
| Application -> object storage | public credential leakage, orphan/deleted assets | server-side provider adapter, validated/re-encoded images, DB metadata, protected deletion, S3 production policy |
| Release automation -> production | secret exposure, migration race, bad rollback | immutable images, separate migrator, one-shot migrations, environment secrets, preflight, image rollback, managed PITR |

## High-value abuse cases

- A customer tries another customer's numeric IDs: ownership or elevated permission is enforced in use-cases; user-profile probes intentionally collapse unauthorized/existing and missing to 404.
- A caller attempts to reserve inventory without paying: raw internet order creation was removed in Phase 18; customer order creation enters through Cart + Checkout + PaymentAttempt.
- An attacker forges `status`, totals, prices or user IDs: schemas do not accept authoritative fields and totals/product identity are resolved server-side.
- Duplicate payment/webhook delivery: unique references/natural keys and guarded state transitions make reprocessing idempotent.
- A compromised browser session tries admin routes: having a session is insufficient; business permissions are loaded server-side from Watplux RBAC and use-cases enforce them.
- A client spoofs forwarded IP headers: only the configured ingress-controlled header is trusted; production ingress must overwrite it.

## Residual release risks

Current Paystack refund webhook payload behavior, real-provider S3 semantics, real managed-MySQL restore behavior, dependency/build state and deployed browser performance cannot be proven from source alone. They remain explicit release gates in `docs/PHASE_18_FINAL_ARCHITECTURE_RELEASE_AUDIT.md`.
