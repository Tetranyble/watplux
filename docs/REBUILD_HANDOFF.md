# Rebuild Handoff

## What changed

This working copy was re-examined as a whole rather than continuing the previous phase-by-phase implementation mechanically.

The main architectural correction is the authentication boundary:

- Better Auth is now the production identity/session owner.
- Existing application RBAC remains independent and authoritative for commerce permissions.
- Prisma/MySQL remain the data layer.
- The customer storefront and `/admin` operations workspace remain separate route/layout trees.
- Customer account and admin-customer security flows were cleaned up.
- Existing Catalog product-management use-cases remain the only mutation path for products/variants/images/specifications.

## Better Auth files

New/changed runtime entry points include:

- `lib/auth.ts`
- `lib/auth-client.ts`
- `lib/session.ts`
- `proxy.ts`
- `app/api/auth/[...all]/route.ts`
- `app/(storefront)/login/**`
- `app/(storefront)/register/**`
- `app/(storefront)/account/actions.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260830233000_better_auth/migration.sql`

See `docs/BETTER_AUTH_REBUILD.md` for migration behavior and flow diagrams.

## Customer flow improvements

The customer experience now has a clear path:

```text
Browse → Cart → Register/Sign in → Account → Orders / Cart / Security
```

The account page is a real customer control centre rather than a bare logout page. Better Auth sessions remain server-resolved; the browser never decides identity or permissions.

## Admin flow improvements

The operations route tree has its own shell/sidebar and does not reuse storefront chrome.

Customer administration now includes:

- cursor-paginated/searchable user list;
- customer/staff detail;
- server-authorized role management;
- suspend/reactivate;
- force logout of all sessions.

Suspending a user deletes their active Better Auth sessions and the auth/session seam independently rejects inactive users.

Product administration continues through the existing Catalog domain:

```text
Products → Product detail
           ├─ lifecycle
           ├─ variants/default
           ├─ images/primary
           └─ specifications
```

No direct Prisma mutation was added to UI/routes.

## Prisma decision

Prisma was retained. This project already has working seed scripts and Prisma remains the ORM for every commerce domain. Removing it would be a wholesale data-layer rewrite unrelated to the authentication problem.

## Verification limitation in this rebuild environment

The container could not resolve `registry.npmjs.org`. Because Better Auth was not present in the uploaded lockfile and packages could not be downloaded, this environment could **not** truthfully run the post-migration TypeScript/build/test suite or regenerate `package-lock.json`.

This is an environment limitation, not a claim that the migration has already passed verification.

Before treating this rebuild as production-ready, run from a machine with npm registry access:

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

Then review and commit the regenerated `package-lock.json`.

For an existing database, back it up before applying the Better Auth migration. Existing sessions will be revoked by design.
