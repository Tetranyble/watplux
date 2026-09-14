# Phase 14 — Media & Commerce Experience

**Status:** SOURCE IMPLEMENTATION COMPLETE — DEPENDENCY/BUILD VERIFICATION PENDING

## Engineering decision

Phase 14 adopts the useful parts of the earlier Ugbanawaji portfolio media architecture — a reusable media library, provider abstraction, stable application URLs, explicit upload validation and a storage-independent CMS workflow — but removes portfolio-specific concerns that do not belong in commerce. Watplux does **not** use Google Drive as product-asset infrastructure. Product assets are backed by local disk in development and an S3-compatible object store in production.

The catalog continues to store URL references (`product_images.url`, `categories.image_url`, `brands.logo_url`). A new `media_assets` table owns the physical-storage metadata. This deliberately avoids forcing every catalog aggregate to understand S3 keys or storage providers, while allowing one uploaded asset to be reused across products, brands and categories.

## Stable URL boundary

New uploads receive a canonical URL in the form:

`/api/media/<uuid>`

Catalog rows store that URL, not an S3 bucket URL. The public media route resolves the current storage provider and streams the immutable object. As a result, moving an object from local storage to S3/R2 later does not require rewriting catalog records.

This also closes Phase 9's image-optimization gap for managed assets: same-origin `/api/media/**` images can use `next/image` without guessing a remote CDN hostname. Legacy manually-entered remote URLs remain supported with `unoptimized` as a compatibility fallback only.

## Upload security and normalization

Accepted source types are JPEG, PNG, WebP and AVIF. Upload size is bounded by `MEDIA_UPLOAD_MAX_MB` (10 MB default). `sharp` decodes the source, auto-orients it, limits the longest edge to 3200 px, re-encodes to WebP, and strips source metadata as part of the re-encode. The stored SHA-256 checksum, dimensions, byte size, MIME type, original filename, provider and creator are recorded in `media_assets`.

The browser never supplies the storage key. Keys are generated server-side under `catalog/YYYY/MM/<uuid>.webp`.

## Storage providers

- `LOCAL` — development/default; writes under `.storage/media` (configurable).
- `S3` — production-ready S3-compatible provider using `@aws-sdk/client-s3`; endpoint and path-style options permit AWS S3, Cloudflare R2, MinIO and compatible services.

Storage is behind `src/integrations/storage/*`; catalog and UI code never imports an S3 client directly.

## Admin experience

`/admin/catalog/media` now provides a reusable media library inspired by the portfolio CMS:

- multi-image uploads;
- processed-image metadata;
- keyset pagination / Load more;
- stable URL copy action;
- deletion with explicit confirmation;
- reference protection: an asset cannot be deleted while its public URL is still referenced by a product image, category image or brand logo.

Product image management now makes upload the primary path and preserves URL entry as a legacy/external escape hatch. Uploaded dimensions are passed into the existing `addProductImage` use-case, preserving the existing primary-image and catalog invariants.

Brand logo and category image editing use the same media upload field rather than separate upload implementations.

## Storefront image behavior

Managed media URLs now use the normal Next image pipeline. Product cards and PDP galleries use `object-contain` presentation so solar equipment is not aggressively cropped like fashion photography. Existing external URLs remain functional during development/migration.

## Commerce UX pass

The checkout surface was tightened without changing checkout/order/payment semantics:

- clearer secure-checkout hierarchy;
- contact and delivery sections;
- sticky order summary on large screens;
- explicit Paystack handoff language;
- removed misleading tax/delivery wording that implied engines not yet implemented;
- out-of-stock products can no longer present an enabled Add-to-cart button;
- quantity increment is bounded by the current server-supplied available quantity and resets when the selected variant changes.

The server remains authoritative for stock, totals, cart ownership and payment initialization.

## Schema / migration

Added `MediaStorageProvider` and `MediaAsset`, plus migration:

`prisma/migrations/20260831003000_media_domain/migration.sql`

Existing product/category/brand tables were not rewritten.

## New dependencies

- `@aws-sdk/client-s3`
- `sharp`

The execution environment does not currently have project `node_modules` and cannot reach the npm registry. Therefore `package-lock.json` cannot be truthfully regenerated here. Run `npm install` once in a networked development environment and commit the resulting lockfile before CI uses `npm ci`.

## Verification completed in this environment

- TypeScript/TSX syntax transpile scan: **470 files, 0 syntax errors**.
- Internal `@/...` import resolution scan: **1,734 imports, 0 unresolved internal imports**.
- Local storage directory is gitignored.

## Verification still required

After dependency installation:

```bash
nvm use
npm install
npm run db:generate
npx prisma migrate dev
npm run typecheck
npm run lint
npm run format
npm test
npm run test:integration
npm run test:e2e
npm run build
```

A real S3-compatible test should also verify upload, read/cache behavior and object deletion before production credentials are accepted.

## Phase 14 completion boundary

The source architecture and UX changes are complete. Production provider selection/credentials remain a deployment decision; Phase 17 can choose AWS S3, Cloudflare R2 or another compatible provider without touching the catalog domain.
