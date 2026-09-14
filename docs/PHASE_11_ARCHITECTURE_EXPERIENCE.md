# Phase 11 — Architecture & Experience Stabilization

**Status: code-complete; final dependency/build verification blocked only by package-registry access in the current execution environment.**

## Architectural decision

Watplux now has one authentication model, not two:

```text
Browser / Server Action / Route Handler
        |
        v
Better Auth
(identity, credential account, session, verification lifecycle)
        |
        v
lib/session.ts
        |
        v
AuthenticatedUser
        |
        v
Watplux RBAC
(roles + business permissions)
        |
        v
Domain use-cases
```

Better Auth authenticates. Watplux authorizes.

The former custom `login`, `register`, `logout`, `logout-all`, password-reset,
email-verification, raw-session-token resolution and compatibility token-delivery
use-cases have been removed. They no longer exist merely to keep old tests alive.

`auth/repo.ts` now retains only persistence that actually belongs to Watplux:
user/profile reads, RBAC resolution/assignment, admin account operations,
audit writes, customer metrics, Better-Auth-compatible bootstrap/test account
creation, and explicit cross-user session revocation for `users.manage` operations.
Session issuance/validation is no longer a Watplux repository responsibility.

Authentication lifecycle coverage now lives at the real Better Auth HTTP boundary
in `tests/e2e/auth.spec.ts`; domain integration fixtures build persisted users and
RBAC actors directly instead of emulating a second authentication system.

## Better Auth / Prisma decision

Keep Prisma 6.19.x + MySQL for this release line. Prisma remains the canonical
application persistence layer and the project keeps explicit structural and dev
seed scripts. Better Auth uses the Prisma adapter while retaining the existing
numeric `users.id`, preserving all commerce-domain foreign keys.

For the current Better Auth line, Watplux imports `betterAuth` from
`better-auth/minimal` and the Prisma adapter from `@better-auth/prisma-adapter`.
This keeps the ORM adapter explicit and avoids bundling the direct-database layer
that is unnecessary when Prisma is already the database boundary.

## Design-system decision

Watplux uses a restrained energy palette rather than a generic neutral shadcn skin:

- deep solar green: primary brand/action color;
- solar gold: selective energy accent;
- warm green-neutral light surfaces;
- dark ink-green surfaces for dark mode;
- semantic success/warning/destructive/chart/sidebar tokens.

All application components consume semantic Tailwind v4/shadcn tokens. Brand
values are centralized in `app/globals.css`. `next-themes` provides system/light/
dark theme behavior through the shared `ThemeProvider` and `ThemeToggle`.

## Experience architecture

Customer and admin are distinct products sharing design primitives, not chrome.

```text
Customer
Discover -> Product -> Cart -> Checkout -> Paystack -> Confirmation -> Orders
      \-> Consultation / Installation -> Service request tracking

Operations
Dashboard -> Orders / Inventory / Catalog / Payments / Services / Customers
```

Customer surfaces prioritize confidence, clear next actions and readable product
information. Operations surfaces prioritize scanning, status, safe mutations and
server-authoritative workflows.

## Work completed

- Better Auth is the only runtime authentication/session owner.
- Legacy custom auth/session/token production use-cases removed.
- Compatibility session/verification repository methods removed.
- Old password-reset/email-verification compatibility environment values removed.
- Auth integration fixtures no longer issue fake Watplux sessions.
- Better Auth real HTTP lifecycle tests retained as the authentication contract.
- Watplux RBAC and admin session-revocation operations preserved.
- Better Auth Prisma adapter import/bundle boundary tightened.
- Light/dark brand design tokens and theme provider established.
- Storefront header/footer/home/product cards aligned to the Watplux visual system.
- Account centre and admin shell aligned to the same tokens while retaining separate UX.

## Verification status

The current execution environment cannot resolve/download npm packages, and this
repository snapshot has no `node_modules`. Therefore TypeScript, ESLint, Vitest,
Playwright and `next build` cannot be truthfully claimed as executed here.

The first verification run in an environment with package-registry access must run:

```bash
nvm use
npm install
npm run db:generate
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:integration
npm run test:e2e
npm run build
```

`npm install` must also refresh `package-lock.json` because Better Auth dependencies
were introduced after the lockfile in the original source snapshot.
