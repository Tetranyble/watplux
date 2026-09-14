# Post-Phase 18 — UI System Polish

This pass uses the user's SVITES project as a composition reference while preserving Watplux's existing architecture, domain schemas, routes and brand system.

## What changed

- Standardized visible form controls and actions on the shadcn layer in `components/ui/*`.
- Added shared React Hook Form controlled fields, including searchable selects and explicit `emptyAsUndefined` vs `emptyAsNull` semantics.
- Standardized meaningful forms on live validation (`mode: "onChange"`, `reValidateMode: "onChange"`).
- Added URL-controlled create/edit dialogs (`?dialog=...&item=...`) so contextual modal state works with Back/Forward and deep links.
- Added reusable search/create and URL-filter compositions.
- Reworked brands, categories, variants, specifications, images, product create/edit, inventory mutations, refunds, auth forms, consultation/installation intake and checkout around the same form language.
- Replaced ad-hoc confirmations with `ConfirmDialog`.
- Replaced raw admin/customer/service-request filters with shadcn + RHF URL filters.
- Added real-time range validation to storefront price/power filters.
- Added `npm run audit:ui` and made it part of `release:gate` so future feature work cannot casually reintroduce raw visible controls, `window.confirm`, manual form scraping, or non-live RHF forms.

## Architectural boundary

This was a presentation/composition refactor. Authentication, RBAC, checkout/payment orchestration, inventory invariants, catalog use-cases, media storage boundaries and deployment architecture were not replaced.

Client validation remains UX. Existing server route/use-case validation remains authoritative.
