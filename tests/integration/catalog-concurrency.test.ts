import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { addProductImage } from "@/src/modules/catalog/use-cases/add-product-image";
import { archiveVariant } from "@/src/modules/catalog/use-cases/archive-variant";
import { createProduct } from "@/src/modules/catalog/use-cases/create-product";
import { createVariant } from "@/src/modules/catalog/use-cases/create-variant";
import { publishProduct } from "@/src/modules/catalog/use-cases/publish-product";
import { removeProductImage } from "@/src/modules/catalog/use-cases/remove-product-image";
import { setDefaultVariant } from "@/src/modules/catalog/use-cases/set-default-variant";
import { setPrimaryImage } from "@/src/modules/catalog/use-cases/set-primary-image";
import {
  cleanupCatalogTestData,
  createSuperAdminActor,
  createTestCategory,
  createTestProduct,
  uniqueTestName,
  uniqueTestSku,
} from "./helpers/catalog-fixtures";

/**
 * The concurrency tests required by the Phase 4 plan revision
 * (docs/PHASE_4_CATALOG_PLAN.md §13a/§14/§15): genuinely overlapping
 * `Promise.all` calls against the real database, asserting the final row
 * state directly — not sequential awaits with an assumed race, and not
 * just "one call threw."
 */
describe("catalog: concurrency and the product-row lock (§13a)", () => {
  afterAll(cleanupCatalogTestData);

  it(
    "two concurrent archiveVariant calls on a product's only two ACTIVE variants " +
      "never leave it ACTIVE with zero ACTIVE variants",
    async () => {
      const admin = await createSuperAdminActor();
      const product = await createTestProduct(admin);
      const variantA = BigInt(product.variants[0]!.id); // isDefault: true
      const variantB = await createVariant(admin, {
        productId: BigInt(product.id),
        sku: uniqueTestSku(),
        priceMinor: 150_000,
      });
      await publishProduct(admin, BigInt(product.id));

      const results = await Promise.allSettled([
        archiveVariant(admin, variantA),
        archiveVariant(admin, BigInt(variantB.id)),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0]?.status === "rejected") {
        expect(rejected[0].reason).toMatchObject({ statusCode: 400 });
      }

      // The direct database re-read — not inferred from which call threw
      // — is the actual assertion the correction required.
      const finalProduct = await db.product.findUniqueOrThrow({
        where: { id: BigInt(product.id) },
      });
      const finalVariants = await db.productVariant.findMany({
        where: { productId: BigInt(product.id) },
      });
      const activeVariants = finalVariants.filter((v) => v.status === "ACTIVE");

      const isInvalidState =
        finalProduct.status === "ACTIVE" && activeVariants.length === 0;
      expect(isInvalidState).toBe(false);

      expect(activeVariants).toHaveLength(1);
      expect(activeVariants[0]?.isDefault).toBe(true);
    },
  );

  it(
    "publishProduct racing archiveVariant on the sole ACTIVE/default variant " +
      "never leaves the product ACTIVE with zero ACTIVE variants",
    async () => {
      const admin = await createSuperAdminActor();
      const product = await createTestProduct(admin); // DRAFT, one ACTIVE default variant
      const soleVariantId = BigInt(product.variants[0]!.id);

      await Promise.allSettled([
        publishProduct(admin, BigInt(product.id)),
        archiveVariant(admin, soleVariantId),
      ]);

      const finalProduct = await db.product.findUniqueOrThrow({
        where: { id: BigInt(product.id) },
      });
      const activeVariantCount = await db.productVariant.count({
        where: { productId: BigInt(product.id), status: "ACTIVE" },
      });

      const isInvalidState =
        finalProduct.status === "ACTIVE" && activeVariantCount === 0;
      expect(isInvalidState).toBe(false);
    },
  );

  it("two concurrent setDefaultVariant calls end with exactly one default, never zero or two", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantB = await createVariant(admin, {
      productId: BigInt(product.id),
      sku: uniqueTestSku(),
      priceMinor: 150_000,
    });
    const variantC = await createVariant(admin, {
      productId: BigInt(product.id),
      sku: uniqueTestSku(),
      priceMinor: 175_000,
    });

    await Promise.allSettled([
      setDefaultVariant(admin, BigInt(variantB.id)),
      setDefaultVariant(admin, BigInt(variantC.id)),
    ]);

    const variants = await db.productVariant.findMany({
      where: { productId: BigInt(product.id) },
    });
    const defaults = variants.filter((v) => v.isDefault);
    expect(defaults).toHaveLength(1);
  });

  it("two concurrent createVariant calls with the same SKU: exactly one succeeds, the other gets ConflictError", async () => {
    const admin = await createSuperAdminActor();
    const productX = await createTestProduct(admin);
    const productY = await createTestProduct(admin);
    const sharedSku = uniqueTestSku();

    const results = await Promise.allSettled([
      createVariant(admin, {
        productId: BigInt(productX.id),
        sku: sharedSku,
        priceMinor: 100_000,
      }),
      createVariant(admin, {
        productId: BigInt(productY.id),
        sku: sharedSku,
        priceMinor: 100_000,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === "rejected") {
      expect(rejected[0].reason).toMatchObject({ statusCode: 409 });
    }

    const matchingVariants = await db.productVariant.findMany({
      where: { sku: sharedSku },
    });
    expect(matchingVariants).toHaveLength(1);
  });

  it("two concurrent createProduct calls with the same AUTO-derived slug both succeed with distinct suffixed slugs", async () => {
    const admin = await createSuperAdminActor();
    const category = await createTestCategory(admin);
    const sharedName = uniqueTestName("ConcurrentAutoSlug");

    const results = await Promise.allSettled([
      createProduct(admin, {
        name: sharedName,
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 100_000 },
      }),
      createProduct(admin, {
        name: sharedName,
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 100_000 },
      }),
    ]);

    const fulfilled = results.filter(
      (
        r,
      ): r is PromiseFulfilledResult<
        Awaited<ReturnType<typeof createProduct>>
      > => r.status === "fulfilled",
    );
    expect(fulfilled).toHaveLength(2);

    const slugs = fulfilled.map((r) => r.value.slug);
    expect(new Set(slugs).size).toBe(2); // distinct — one got the -2 suffix
  });

  it("two concurrent createProduct calls with the same EXPLICIT slug: exactly one succeeds, the other gets ConflictError", async () => {
    const admin = await createSuperAdminActor();
    const category = await createTestCategory(admin);
    const sharedSlug = `phase4test-explicit-concurrent-${Date.now()}`;

    const results = await Promise.allSettled([
      createProduct(admin, {
        name: uniqueTestName("ExplicitSlugA"),
        slug: sharedSlug,
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 100_000 },
      }),
      createProduct(admin, {
        name: uniqueTestName("ExplicitSlugB"),
        slug: sharedSlug,
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 100_000 },
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === "rejected") {
      expect(rejected[0].reason).toMatchObject({ statusCode: 409 });
    }

    const matchingProducts = await db.product.findMany({
      where: { slug: sharedSlug },
    });
    expect(matchingProducts).toHaveLength(1); // never a "-2" fallback row
  });

  // ---------------------------------------------------------------------
  // Primary-image invariant — added on review after the implementation
  // report disclosed this invariant had no product-row lock (unlike the
  // variant-default invariant above). Same product-row-lock mechanism
  // (§13a) now applies to addProductImage/setPrimaryImage/removeProductImage
  // — see repo.ts's `lockProductRow` calls in those functions.
  // ---------------------------------------------------------------------

  it("two concurrent setPrimaryImage calls on two different images of the same product: exactly one ends up primary", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const imageA = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-a.jpg",
    });
    const imageB = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-b.jpg",
    });

    await Promise.allSettled([
      setPrimaryImage(admin, BigInt(imageA.id)),
      setPrimaryImage(admin, BigInt(imageB.id)),
    ]);

    const images = await db.productImage.findMany({
      where: { productId: BigInt(product.id) },
    });
    const primaries = images.filter((i) => i.isPrimary);
    expect(primaries).toHaveLength(1);
  });

  it("two concurrent addProductImage(isPrimary=true) calls on the same product: exactly one ends up primary", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);

    await Promise.allSettled([
      addProductImage(admin, {
        productId: BigInt(product.id),
        url: "https://cdn.example.test/panel-c.jpg",
        isPrimary: true,
      }),
      addProductImage(admin, {
        productId: BigInt(product.id),
        url: "https://cdn.example.test/panel-d.jpg",
        isPrimary: true,
      }),
    ]);

    const images = await db.productImage.findMany({
      where: { productId: BigInt(product.id) },
    });
    const primaries = images.filter((i) => i.isPrimary);
    expect(primaries).toHaveLength(1);
  });

  it("removeProductImage(primary) racing setPrimaryImage(otherImage) always ends in a valid primary-image state", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const primaryImage = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-e.jpg",
    });
    const otherImage = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-f.jpg",
    });
    expect(primaryImage.isPrimary).toBe(true);

    await Promise.allSettled([
      removeProductImage(admin, BigInt(primaryImage.id)),
      setPrimaryImage(admin, BigInt(otherImage.id)),
    ]);

    const remainingImages = await db.productImage.findMany({
      where: { productId: BigInt(product.id) },
    });
    const primaries = remainingImages.filter((i) => i.isPrimary);
    // With the product-row lock, both possible orderings converge to the
    // same result — `otherImage` ends up the sole remaining, sole primary
    // image, whichever call the lock lets through first:
    //   - remove-first: deletes primaryImage, its own promotion logic
    //     makes otherImage primary; the now-unblocked setPrimaryImage
    //     re-reads that fresh state and just confirms it.
    //   - setPrimary-first: makes otherImage primary (unsetting
    //     primaryImage); the now-unblocked removeProductImage re-reads
    //     primaryImage post-lock, sees isPrimary is already false, and
    //     correctly skips its own promotion step.
    // Never zero, never two — the actual invariant this test protects.
    expect(remainingImages).toHaveLength(1);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.id.toString()).toBe(otherImage.id);
  });
});
