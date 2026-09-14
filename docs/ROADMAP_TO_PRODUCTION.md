# Watplux — Architecture-to-Production Roadmap

Status: source release candidate. The project is still pre-launch; production release remains gated by the Phase 18 external verification checklist.

## Decision principles

1. Better Auth owns identity, credential accounts, sessions, verification and authentication lifecycle.
2. Watplux owns business authorization (roles/permissions) and domain policy.
3. Prisma/MySQL remains the persistence layer. Prisma 6 supports the project's explicit seed workflow; seeding is not a reason to replace it.
4. Server Components remain the default rendering model; client components are interaction leaves only.
5. Tailwind v4 + shadcn/base-nova is the single UI system. Brand styling is expressed through semantic CSS variables, never scattered hex values in components.
6. Domain invariants stay in domain/application use-cases, never in React components or generic CRUD endpoints.
7. Because the app is not live, we prefer clean cutovers over long-lived compatibility shims.

## Remaining stages

### Phase 11 — Architecture & Experience Stabilization — CODE COMPLETE, VERIFICATION PENDING

- Remove legacy custom-auth production pathways and legacy session/token semantics.
- Keep only Better Auth authentication + Watplux RBAC.
- Rework auth tests around Better Auth instead of compatibility helpers.
- Establish the Watplux design tokens, light/dark themes, brand lockup and common page/surface patterns.
- Normalize storefront/customer/admin information architecture and visual hierarchy.
- Eliminate obvious placeholders and duplicate UX patterns where real configuration is not yet available.

### Phase 12 — Consultation & Installation Workflow — IMPLEMENTED, VERIFICATION PENDING

- Implement the existing `ServiceRequest` domain as a real application module.
- Customer consultation/installation request flows.
- Admin queue/detail/assignment/status workflow under existing consultation permissions.
- No fake email infrastructure; notification hooks remain adapters until a provider is chosen.

### Phase 13 — Search & Discovery — IMPLEMENTED, VERIFICATION PENDING

- Measure current MySQL LIKE queries.
- Introduce MySQL full-text search only if query/data evidence justifies it; pre-launch migrations are allowed when architecturally correct.
- Facets, price sorting cursor design, stock-aware discovery if it can preserve pagination correctness.
- Complete SEO consistency and indexability audit.

### Phase 14 — Media & Commerce Experience — SOURCE IMPLEMENTED, VERIFICATION PENDING

- Storage-provider abstraction implemented: local development + S3-compatible production. Final production provider/credentials remain Phase 17 deployment configuration.
- Reusable media library, upload processing, product/category/brand media UX implemented.
- Managed same-origin media now uses Next image optimization; only legacy arbitrary remote URLs keep the compatibility `unoptimized` fallback.
- Checkout/PDP/cart source-level UX polish implemented; real browser measurements remain part of Phases 15–16.

### Phase 15 — Performance & Security Hardening — SOURCE IMPLEMENTED, VERIFICATION PENDING

- Rate limiting for auth and sensitive public endpoints.
- Security headers/CSP, input and redirect review, session/security review.
- Query plans/index review against real critical paths.
- Webhook worker health/staleness monitoring.
- Lighthouse/Core Web Vitals pass in a real browser.

### Phase 16 — Release Test Program — SOURCE IMPLEMENTED, VERIFICATION PENDING

- Browser-mode Playwright journeys in addition to API-contract tests.
- Visual/responsive smoke coverage.
- Accessibility checks.
- Failure/retry/payment/order/inventory regression suite.
- Test cleanup debt eliminated, including generic audit-log leftovers.

### Phase 17 — Deployment & Operations — SOURCE IMPLEMENTED, LIVE DEPLOYMENT PENDING

- Multi-stage production Dockerfile with standalone non-root runtime and separate one-shot migrator image.
- Managed MySQL 8-compatible production policy, release migration procedure, backup/PITR and restore requirements.
- S3-compatible production media configuration and immutable stable media URL strategy.
- Webhook worker scheduler reference deployment and authenticated health monitoring.
- Separate liveness/readiness endpoints, release metadata in structured logs, preflight checks, backup and rollback runbooks.
- GitHub release workflow for verified immutable runtime/migrator images.

### Phase 18 — Final Architecture & Release Audit — SOURCE RELEASE CANDIDATE COMPLETE

- Threat model and architecture-boundary audit completed.
- Route/RBAC and schema/index posture audited; executable release-audit guard added.
- Raw `POST /api/orders` bypass removed so Checkout is the only customer order-creation HTTP boundary.
- User-profile ID enumeration tightened to non-disclosing 404 behavior.
- Production data/secrets/operations checklist and final go/no-go report documented.
- Source architecture gate: GO. Production gate: NO-GO until dependency/build/tests, Paystack/refund, S3, backup/restore and staging evidence pass.
- Post-audit UI system polish completed: shadcn primitives, RHF live validation, URL-controlled contextual dialogs, shared search/filter/create compositions, and an executable UI consistency audit.

## Execution policy

The stages above are sequential. We do not wait for a fresh architecture approval between stages. Work moves to the next stage when the current stage's verification passes. We stop only for a genuine external decision (for example, credentials, legal/business content, or hosting/provider selection that cannot be derived safely) or a destructive migration requiring explicit business acceptance.
