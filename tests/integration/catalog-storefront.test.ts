import { afterAll, describe, expect, it } from "vitest";

import { getBrandBySlug } from "@/src/modules/catalog/use-cases/get-brand-by-slug";
import { getCategoryBySlug } from "@/src/modules/catalog/use-cases/get-category-by-slug";
import { createProduct } from "@/src/modules/catalog/use-cases/create-product";
import { publishProduct } from "@/src/modules/catalog/use-cases/publish-product";
import { listProducts } from "@/src/modules/catalog/use-cases/list-products";
import { deactivateBrand } from "@/src/modules/catalog/use-cases/deactivate-brand";
import { deactivateCategory } from "@/src/modules/catalog/use-cases/deactivate-category";
import { NotFoundError } from "@/lib/errors";
import { restockInventory } from "@/src/modules/inventory/use-cases/restock-inventory";
import {
  cleanupCatalogTestData,
  createSuperAdminActor,
  createTestBrand,
  createTestCategory,
  uniqueTestName,
  uniqueTestSku,
} from "./helpers/catalog-fixtures";

/**
 * Phase 9 additive catalog reads (docs/PHASE_9_STOREFRONT_PLAN.md §31):
 * public by-slug lookups for category/brand, plus the extended
 * price/solar-facet listing filters and the two supported sort orders
 * ("newest"/"featured"). Existing catalog behavior (Phase 4 tests) is
 * re-verified untouched in `catalog-products.test.ts` et al. — this file
 * covers only the new surface.
 */
describe("catalog: storefront additions", () => {
  afterAll(cleanupCatalogTestData);

  describe("getCategoryBySlug / getBrandBySlug", () => {
    it("returns an active category by slug", async () => {
      const admin = await createSuperAdminActor();
      const category = await createTestCategory(admin);
      const found = await getCategoryBySlug(category.slug);
      expect(found.id).toBe(category.id);
    });

    it("404s for a nonexistent category slug", async () => {
      await expect(getCategoryBySlug("does-not-exist-xyz")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("404s for an inactive category — never leaks it via slug", async () => {
      const admin = await createSuperAdminActor();
      const category = await createTestCategory(admin);
      await deactivateCategory(admin, BigInt(category.id));
      await expect(getCategoryBySlug(category.slug)).rejects.toThrow(
        NotFoundError,
      );
    });

    it("returns an active brand by slug", async () => {
      const admin = await createSuperAdminActor();
      const brand = await createTestBrand(admin);
      const found = await getBrandBySlug(brand.slug);
      expect(found.id).toBe(brand.id);
    });

    it("404s for a nonexistent brand slug", async () => {
      await expect(getBrandBySlug("does-not-exist-xyz")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("404s for an inactive brand — never leaks it via slug", async () => {
      const admin = await createSuperAdminActor();
      const brand = await createTestBrand(admin);
      await deactivateBrand(admin, BigInt(brand.id));
      await expect(getBrandBySlug(brand.slug)).rejects.toThrow(NotFoundError);
    });
  });

  describe("listProducts: price range + solar facet filters", () => {
    it("filters by minPriceMinor/maxPriceMinor against the variant price", async () => {
      const admin = await createSuperAdminActor();
      const category = await createTestCategory(admin);
      const cheap = await createProduct(admin, {
        name: uniqueTestName("CheapPanel"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 50_000 },
      });
      const expensive = await createProduct(admin, {
        name: uniqueTestName("ExpensivePanel"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 500_000 },
      });
      await publishProduct(admin, BigInt(cheap.id));
      await publishProduct(admin, BigInt(expensive.id));

      const page = await listProducts({
        categoryId: BigInt(category.id),
        featured: undefined,
        minPriceMinor: 100_000,
        limit: 20,
      });

      const ids = page.items.map((p) => p.id);
      expect(ids).toContain(expensive.id);
      expect(ids).not.toContain(cheap.id);
    });

    it("filters by powerRatingW range and phase against variant facets", async () => {
      const admin = await createSuperAdminActor();
      const category = await createTestCategory(admin);
      const matching = await createProduct(admin, {
        name: uniqueTestName("MatchingInverter"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: {
          sku: uniqueTestSku(),
          priceMinor: 100_000,
          powerRatingW: 5000,
          phase: "THREE",
        },
      });
      const nonMatching = await createProduct(admin, {
        name: uniqueTestName("NonMatchingInverter"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: {
          sku: uniqueTestSku(),
          priceMinor: 100_000,
          powerRatingW: 1000,
          phase: "SINGLE",
        },
      });
      await publishProduct(admin, BigInt(matching.id));
      await publishProduct(admin, BigInt(nonMatching.id));

      const page = await listProducts({
        categoryId: BigInt(category.id),
        featured: undefined,
        powerRatingWMin: 3000,
        phase: "THREE",
        limit: 20,
      });

      const ids = page.items.map((p) => p.id);
      expect(ids).toContain(matching.id);
      expect(ids).not.toContain(nonMatching.id);
    });

    it("an archived variant matching a facet filter is excluded from public results", async () => {
      const admin = await createSuperAdminActor();
      const category = await createTestCategory(admin);
      const product = await createProduct(admin, {
        name: uniqueTestName("ArchivedFacetProduct"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 100_000, voltageV: 48 },
      });
      // Never published — status stays DRAFT, so it must never appear in
      // any public listing regardless of the facet filter matching.
      const page = await listProducts({
        categoryId: BigInt(category.id),
        featured: undefined,
        voltageV: 48,
        limit: 20,
      });
      expect(page.items.map((p) => p.id)).not.toContain(product.id);
    });
  });

  describe("listProducts: sortBy", () => {
    it("sortBy=featured orders featured products first, and keyset pagination resumes correctly across the boundary", async () => {
      const admin = await createSuperAdminActor();
      const category = await createTestCategory(admin);

      const nonFeatured = await createProduct(admin, {
        name: uniqueTestName("NonFeatured"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 10_000 },
      });
      const featured = await createProduct(admin, {
        name: uniqueTestName("Featured"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: true,
        variant: { sku: uniqueTestSku(), priceMinor: 10_000 },
      });
      await publishProduct(admin, BigInt(nonFeatured.id));
      await publishProduct(admin, BigInt(featured.id));

      const firstPage = await listProducts({
        categoryId: BigInt(category.id),
        featured: undefined,
        sortBy: "featured",
        limit: 1,
      });
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.items[0]?.id).toBe(featured.id);
      expect(firstPage.nextCursor).not.toBeNull();

      const secondPage = await listProducts({
        categoryId: BigInt(category.id),
        featured: undefined,
        sortBy: "featured",
        cursor: firstPage.nextCursor ?? undefined,
        limit: 1,
      });
      const secondPageIds = secondPage.items.map((p) => p.id);
      expect(secondPageIds).toContain(nonFeatured.id);
      expect(secondPageIds).not.toContain(featured.id); // no duplicate across pages
    });

    it("omitting sortBy preserves the original newest-first cursor behavior exactly", async () => {
      const admin = await createSuperAdminActor();
      const category = await createTestCategory(admin);
      const older = await createProduct(admin, {
        name: uniqueTestName("Older"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 10_000 },
      });
      const newer = await createProduct(admin, {
        name: uniqueTestName("Newer"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 10_000 },
      });
      await publishProduct(admin, BigInt(older.id));
      await publishProduct(admin, BigInt(newer.id));

      const page = await listProducts({
        categoryId: BigInt(category.id),
        featured: undefined,
        limit: 20,
      });
      const ids = page.items.map((p) => p.id);
      // Newest-first: `newer` must appear before `older`.
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    });
  });

  describe("listProducts: Phase 13 discovery", () => {
    it("searches across product name, brand, category and variant SKU", async () => {
      const admin = await createSuperAdminActor();
      const category = await createTestCategory(admin);
      const brand = await createTestBrand(admin);
      const sku = uniqueTestSku();
      const product = await createProduct(admin, {
        name: uniqueTestName("DiscoveryBattery"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        brandId: BigInt(brand.id),
        isFeatured: false,
        variant: { sku, priceMinor: 250_000 },
      });
      await publishProduct(admin, BigInt(product.id));

      for (const search of [product.name, brand.name, category.name, sku]) {
        const page = await listProducts({
          search,
          featured: undefined,
          limit: 20,
        });
        expect(page.items.map((item) => item.id)).toContain(product.id);
      }
    });

    it("inStockOnly requires positive live availability on a matching active variant", async () => {
      const admin = await createSuperAdminActor();
      const category = await createTestCategory(admin);
      const stocked = await createProduct(admin, {
        name: uniqueTestName("Stocked"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 120_000 },
      });
      const empty = await createProduct(admin, {
        name: uniqueTestName("Empty"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 130_000 },
      });
      await publishProduct(admin, BigInt(stocked.id));
      await publishProduct(admin, BigInt(empty.id));
      await restockInventory(admin, BigInt(stocked.variants[0]!.id), {
        quantity: 3,
      });

      const page = await listProducts({
        categoryId: BigInt(category.id),
        featured: undefined,
        inStockOnly: true,
        limit: 20,
      });
      const ids = page.items.map((item) => item.id);
      expect(ids).toContain(stocked.id);
      expect(ids).not.toContain(empty.id);
    });

    it("price_asc and price_desc use the default variant price with keyset pagination", async () => {
      const admin = await createSuperAdminActor();
      const category = await createTestCategory(admin);
      const low = await createProduct(admin, {
        name: uniqueTestName("LowPrice"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 10_000 },
      });
      const mid = await createProduct(admin, {
        name: uniqueTestName("MidPrice"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 20_000 },
      });
      const high = await createProduct(admin, {
        name: uniqueTestName("HighPrice"),
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 30_000 },
      });
      await publishProduct(admin, BigInt(low.id));
      await publishProduct(admin, BigInt(mid.id));
      await publishProduct(admin, BigInt(high.id));

      const first = await listProducts({
        categoryId: BigInt(category.id),
        featured: undefined,
        sortBy: "price_asc",
        limit: 2,
      });
      expect(first.items.map((item) => item.id)).toEqual([low.id, mid.id]);
      expect(first.nextCursor).not.toBeNull();
      const second = await listProducts({
        categoryId: BigInt(category.id),
        featured: undefined,
        sortBy: "price_asc",
        cursor: first.nextCursor ?? undefined,
        limit: 2,
      });
      expect(second.items.map((item) => item.id)).toEqual([high.id]);

      const descending = await listProducts({
        categoryId: BigInt(category.id),
        featured: undefined,
        sortBy: "price_desc",
        limit: 20,
      });
      expect(descending.items.slice(0, 3).map((item) => item.id)).toEqual([
        high.id,
        mid.id,
        low.id,
      ]);
    });
  });
});
