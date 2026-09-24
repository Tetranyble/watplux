# Website copy CMS

Public-facing website copy is stored in the `site_copy` database table and managed from **Admin → Website copy** (`/admin/content`). Copy is grouped into sections so an administrator can edit and save one area without affecting pending edits in another.

## Setup

Run the database migration, then seed the canonical copy records:

```sh
npm run db:migrate:deploy
npm run db:seed
```

The seed uses upserts: it creates missing keys and refreshes their editor metadata while preserving copy that has already been edited in the admin area.

## Adding copy

1. Add a uniquely named entry to `prisma/site-copy-seed.ts`.
2. Read it through `copyValue()` on the server or `useSiteCopy()` in a client component.
3. Run `npm run db:seed` and `npm run audit:copy`.

Do not add a code fallback for a required key. Missing seeded content should fail loudly so incomplete deployments are discovered immediately.

## Caching and deployment

Public reads use Next.js cache tags. Saving through the admin API invalidates the site-copy tags immediately. Production builds that execute cached database reads need a migrated and seeded database containing the canonical website copy. Never use a database containing real customer data for an application build.

For the first cPanel deployment, migrate and seed the local release database
before exporting it. The resulting SQL export includes the `site_copy` table
and its initial editable content. Import that export into the empty cPanel
database. `npm run build:cpanel` uses the database configuration already
available in the local environment and does not migrate or seed it.
