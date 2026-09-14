# Phase 16 — Release Test Program

Status: **SOURCE IMPLEMENTED — EXECUTION PENDING DEPENDENCY/DB/BROWSER AVAILABILITY**

Phase 16 changes Watplux from a project with mostly HTTP-boundary E2E tests into a release program that also exercises the rendered application in a real browser.

## 1. Test topology

Playwright now has three explicit projects:

- `api` — the existing real HTTP request/use-case/database boundary suite. Browser files are excluded so this remains fast.
- `chromium` — rendered desktop customer/admin journeys.
- `mobile-chromium` — focused responsive and visual-smoke journeys using the Pixel 7 device profile.

The browser project uses retained trace/video/screenshot artifacts on failure. Responsive smoke tests also attach full-page screenshots to the Playwright report so a release reviewer can inspect the actual rendered state even when the assertions pass.

## 2. Browser journeys added

The rendered browser suite covers:

- registration validation and successful account creation;
- login validation and heading/accessibility semantics;
- homepage → products → product detail → add-to-cart → cart;
- guest checkout client validation before any payment request is sent;
- super-admin authentication and operations navigation;
- public-route accessibility smoke;
- mobile navigation and product-list responsive overflow checks.

Existing API/integration suites continue to carry the deeper failure, retry, payment, inventory, authorization and concurrency matrices. Phase 16 does not duplicate those domain tests in a browser unless browser behavior itself is the risk.

## 3. Accessibility release checks

A dependency-free critical accessibility smoke helper now enforces the high-value structural failures that are practical to gate automatically in every environment:

- `<html lang>`;
- main landmark;
- duplicate DOM IDs;
- image `alt` presence;
- accessible names for visible links/buttons;
- labels for visible form controls;
- valid `aria-describedby` references;
- horizontal-overflow checks on release pages.

This is intentionally described as an accessibility **smoke**, not a complete WCAG certification. Before production, the release checklist still requires keyboard-only navigation, focus-order/focus-visible review, zoom/reflow review, contrast review and at least one screen-reader pass on checkout and account/admin critical paths.

The Phase 16 audit also corrected two issues found while writing the tests:

1. `/login` now has a real visible `h1` on mobile as well as desktop; the marketing heading is subordinate.
2. the product quantity label no longer incorrectly uses `for=` against a non-form `<span>`.
3. storefront and operations layouts now expose keyboard skip links to their main landmarks.

## 4. Security/operational regression slice

A release HTTP spec now verifies:

- CSP/frame/content-type/referrer/permissions headers;
- removal of `X-Powered-By`;
- Paystack webhook 256 KiB request-body cap;
- machine-authentication behavior for the webhook worker health/trigger endpoint.

These tests turn important Phase 15 hardening decisions into regression gates.

## 5. E2E data lifecycle

Playwright now has a `globalSetup` that seeds only structural RBAC reference data, making the E2E suite independently runnable after migrations.

`globalTeardown` now performs a generic audit-log sweep for all E2E actors before phase-specific entity deletion. This fixes the old pattern where every phase had to remember every `audit_logs` row written by its user. Phase 16 browser products, inventory, guest carts, categories and users have their own deterministic prefix cleanup as well.

## 6. CI release gate

CI was corrected so it now:

1. installs dependencies;
2. generates Prisma;
3. applies migrations to the MySQL service;
4. runs typecheck/lint/format/unit tests;
5. runs integration tests (previously absent from CI);
6. builds and health-checks the app without leaving a port-3000 process behind;
7. installs Playwright Chromium;
8. runs API + desktop browser + mobile browser projects;
9. uploads Playwright report/test artifacts on failure.

The old health-check step left `next start` running and then Playwright attempted to launch another CI server on the same port. The new step owns and terminates its process explicitly.

## 7. Commands

```bash
npm run test:e2e:api
npm run test:e2e:browser
npm run test:e2e
npm run test:release
```

For a fresh database, migrations must run before integration/E2E:

```bash
npm run db:generate
npx prisma migrate deploy
```

Browser binaries are also required once per environment:

```bash
npx playwright install chromium
```

## 8. Verification gate

This source snapshot still cannot complete the real release run in the current execution environment because project dependencies/browser binaries are not installed and npm registry resolution has previously been unavailable. Phase 16 must not be marked VERIFIED until `npm install`/lock regeneration, database migration, and `npm run test:release` complete successfully on an environment with MySQL and Chromium.
