# Better Auth Rebuild

## Status

This rebuild replaces the custom production authentication/session runtime with **Better Auth** while keeping the existing application RBAC and commerce-domain boundaries intact.

## Why this change is cleaner

Authentication and authorization now have one clear seam:

```text
Better Auth
  identity + credentials + sessions
          ↓
lib/session.ts
          ↓
AuthenticatedUser
          ↓
application RBAC (roles + permissions)
          ↓
Catalog / Inventory / Order / Payment / Admin use-cases
```

Commerce modules never import Better Auth. They continue to depend only on the existing `AuthenticatedUser` actor and permission checks. This makes the auth provider replaceable without coupling the business domains to it.

## Database model

The existing numeric `users.id` is preserved because it is referenced throughout the commerce schema. Better Auth is configured for mixed IDs: MySQL generates the numeric User ID while session/account/verification records use string UUIDs.

The identity tables are now:

- `users` — profile plus application status fields.
- `accounts` — credential/provider identities; the password hash belongs here.
- `sessions` — Better Auth session records.
- `verifications` — Better Auth one-time verification records.
- `roles`, `permissions`, `user_roles`, `role_permissions` — unchanged application authorization model.

The migration copies every existing Argon2id password hash into a Better Auth credential account. Better Auth is configured to keep using the project's Argon2id implementation, so customers do not need a forced password reset merely because the auth library changed.

## Intentional migration effects

Applying `20260830233000_better_auth` intentionally:

1. signs out every existing session;
2. invalidates legacy password-reset/email-verification links;
3. moves credential password hashes from `users.password_hash` into `accounts.password`;
4. preserves every existing numeric user ID and therefore every order/cart/address/RBAC relationship.

The session reset is deliberate: the former database stored only a SHA-256 representation of the session token, while Better Auth needs to own the session token it issues. Reconstructing the old raw token is impossible and trying to fake a conversion would weaken the migration.

## Runtime endpoints

Better Auth owns the standard catch-all route:

```text
/api/auth/[...all]
```

Examples used by tests/clients:

```text
POST /api/auth/sign-up/email
POST /api/auth/sign-in/email
POST /api/auth/sign-out
GET  /api/auth/get-session
```

The storefront login/register Server Actions call Better Auth server APIs directly. Customer guest-cart merge remains application behavior layered after successful authentication.

## Customer flow

```text
Browse storefront
    ↓
Guest cart (optional)
    ↓
Create account / sign in with Better Auth
    ↓
Application resolves customer role + permissions
    ↓
Guest cart merges on the storefront auth flow
    ↓
/account
    ├── Orders
    ├── Cart
    └── Session security controls
```

Suspended/deleted users fail closed: Better Auth session creation is blocked, and `lib/session.ts` independently rejects inactive application users before constructing an application actor.

## Operations flow

```text
Better Auth session
      ↓
lib/session.ts resolves RBAC
      ↓
/admin layout
      ↓
permission-aware navigation (display only)
      ↓
server-side use-case permission check (authoritative)
      ↓
Catalog / Inventory / Orders / Payments / Customers
```

The operations shell is physically separate from storefront chrome. Customer management now has a server-authorized list/detail flow, account suspension/reactivation, forced session revocation, and role management; none of these expose Better Auth credential/session internals.

## Product management flow

```text
/admin/catalog/products
      ↓
Create product
      ↓
first/default variant
      ↓
Edit product
  ├── lifecycle: draft / publish / archive
  ├── variants: create / update / default / archive / reactivate
  ├── images: add / primary / update / remove
  └── specifications
      ↓
existing Catalog use-cases
      ↓
existing concurrency + invariant protection
```

Admin UI remains presentation only. It never mutates Prisma directly and never bypasses catalog domain rules.

## Prisma and seeding

Prisma is **not** removed. The current Prisma 6 setup supports the repository's seeding workflow, and Prisma remains deeply integrated across every domain. Removing it would be a wholesale data-layer rewrite with no benefit to the Better Auth migration.

`prisma/seed.ts` continues to seed structural RBAC data and can optionally bootstrap a `super_admin`. The bootstrap utility now writes a Better Auth-compatible credential account.

## Legacy compatibility facade

Some older domain-level auth tests still call helper/use-case functions written before Better Auth. Those helpers have been adapted to the new `accounts`, `sessions`, and `verifications` schema so the migration can be incremental. They are **not the production HTTP authentication runtime**.

A later cleanup can migrate the remaining legacy auth-unit tests to Better Auth APIs and then remove this compatibility facade without changing any commerce module.

## Required local verification

After the Better Auth packages are available:

```bash
nvm use
npm install
npm run db:generate
npx prisma migrate deploy   # production/staging; use your normal dev migration workflow locally
npm run db:seed
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:integration
npm run test:e2e
npm run build
```

### Dependency lock note

The rebuild environment could not resolve `registry.npmjs.org`, so the new packages could not be downloaded and `package-lock.json` could not be regenerated here. Do **not** use the old lockfile as proof that Better Auth has been installed. Run `npm install` with registry access, review/commit the resulting lockfile, and only then restore `npm ci` as the strict CI installation command.
