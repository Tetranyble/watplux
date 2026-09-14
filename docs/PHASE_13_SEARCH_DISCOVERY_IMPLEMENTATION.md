# Phase 13 — Search & Discovery Implementation

**Status: source implementation complete; runtime verification pending dependency installation and the pinned Node 22.23.1 runtime.**

## 1. Engineering decision

The project remains MySQL-first. No search service and no FULLTEXT migration is introduced without query-plan/data evidence. The current pre-launch catalog does not justify Elasticsearch, Algolia, Meilisearch, OpenSearch, or a separate search index.

Instead, Phase 13 strengthens the existing catalog query contract while preserving keyset pagination and the Product/Variant model.

## 2. Search behavior

The former search predicate matched only `Product.name`.

Search now tokenizes up to six whitespace-separated terms. Every term must match at least one searchable catalog field:

- product name;
- short description;
- brand name;
- category name;
- active variant SKU;
- active variant label.

This remains regular MySQL string matching. A FULLTEXT index remains an evidence-driven future optimization, not an architectural default.

## 3. Price sorting

Storefront listing now supports:

- `newest`;
- `featured`;
- `price_asc`;
- `price_desc`.

Price ordering uses the product's default variant price, which is the same merchandising price shown by the product-card summary. Because Prisma cannot directly order a Product by a scalar field on a to-many relation, the price path uses two bounded queries:

1. keyset-page the default variants by `(priceMinor, productId)`;
2. hydrate those product IDs using the existing ProductSummary select and restore the keyset order in memory.

No OFFSET pagination and no duplicated price column were introduced.

The opaque product cursor remains backward-compatible and now optionally carries the default-variant price for price-sorted pages.

## 4. Stock-aware discovery

A new `inStockOnly` catalog filter requires at least one ACTIVE variant that both:

- matches the selected variant facets; and
- has `quantity_available > 0` through its existing `InventoryItem` relation.

This is deliberately composed inside the same variant predicate so a product is not considered in stock because of an unrelated variant while a different variant matched the voltage/power/price facet.

Stock-aware listings bypass the Phase 9 minutes-level catalog listing cache because availability is live operational state. Other public catalog listings keep the existing cache behavior.

## 5. Storefront UX

`/products` now exposes:

- in-stock-only filtering;
- price low-to-high sorting;
- price high-to-low sorting;
- existing category, brand, price range, power, voltage and phase facets.

The filter remains a native GET form. React Hook Form is reserved for mutating/validated forms rather than adding client JavaScript to a read-only discovery form.

## 6. SEO consistency

The plain `/products` listing remains canonical and indexable.

Search/faceted/sorted listing URLs canonicalize to `/products` and are marked `noindex,follow`, preventing query-parameter combinations from competing with dedicated Product, Category and Brand landing pages while still allowing crawlers to follow product links.

Product, category and brand canonical metadata remains unchanged.

## 7. React Hook Form adoption completed alongside Phase 13

The project already declared `react-hook-form` and `@hookform/resolvers`; this stage makes them the standard for meaningful mutating forms rather than keeping them isolated to product create/edit.

Converted to React Hook Form + the domain Zod source of truth:

- login;
- registration;
- change password;
- consultation/installation service requests;
- checkout address/contact data;
- inventory restock;
- inventory adjustment;
- inventory return;
- refund request;
- existing product create/edit forms were already using it.

Simple GET filter forms remain native forms. Button-only state transitions remain button actions. This avoids turning React Hook Form into a universal dependency where it adds no validation or state-management value.

## 8. Validation boundary

Client validation is UX only. Every route/server action/use-case still performs its existing authoritative Zod/domain validation.

The change-password server action now also parses the shared `changePasswordSchema`; password policy is therefore no longer duplicated between client and server.

Service-request optional numeric/date preprocessing was corrected so blank optional fields become `undefined` instead of being accidentally coerced to zero/an invalid date.

## 9. Tests added

Catalog integration coverage was extended for:

- discovery across product/brand/category/SKU fields;
- stock-only filtering against live inventory;
- price ascending keyset pagination;
- price descending ordering.

No passing runtime-test claim is made until dependencies can be installed and the real MySQL suite can execute.

## 10. Database impact

Zero schema changes and zero migrations in this stage.

A MySQL FULLTEXT migration is intentionally not created without measurements showing the expanded LIKE query is inadequate at expected catalog size.

## 11. Verification performed without dependencies

The changed TypeScript/TSX files were passed through the globally available TypeScript transpiler with zero syntax diagnostics.

This is not a substitute for project typechecking, Prisma-client type validation, Vitest, Playwright, or `next build`.
