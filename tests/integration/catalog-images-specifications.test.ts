import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { addProductImage } from "@/src/modules/catalog/use-cases/add-product-image";
import { removeProductImage } from "@/src/modules/catalog/use-cases/remove-product-image";
import { removeProductSpecification } from "@/src/modules/catalog/use-cases/remove-product-specification";
import { reorderProductImages } from "@/src/modules/catalog/use-cases/reorder-product-images";
import { upsertProductSpecificationSchema } from "@/src/modules/catalog/schema";
import { setPrimaryImage } from "@/src/modules/catalog/use-cases/set-primary-image";
import { updateProductImage } from "@/src/modules/catalog/use-cases/update-product-image";
import { upsertProductSpecification } from "@/src/modules/catalog/use-cases/upsert-product-specification";
import {
  cleanupCatalogTestData,
  createSuperAdminActor,
  createTestProduct,
} from "./helpers/catalog-fixtures";

describe("catalog: product images", () => {
  afterAll(cleanupCatalogTestData);

  it("the first image on a product is automatically primary", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);

    const image = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel.jpg",
    });

    expect(image.isPrimary).toBe(true);
  });

  it("a subsequent image defaults to non-primary unless explicitly requested", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-1.jpg",
    });

    const second = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-2.jpg",
    });
    expect(second.isPrimary).toBe(false);

    const third = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-3.jpg",
      isPrimary: true,
    });
    expect(third.isPrimary).toBe(true);

    const images = await db.productImage.findMany({
      where: { productId: BigInt(product.id) },
    });
    expect(images.filter((i) => i.isPrimary)).toHaveLength(1);
  });

  it("setPrimaryImage performs unset-then-set — at most one primary at any time", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const first = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-1.jpg",
    });
    const second = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-2.jpg",
    });

    await setPrimaryImage(admin, BigInt(second.id));

    const images = await db.productImage.findMany({
      where: { productId: BigInt(product.id) },
    });
    const primaries = images.filter((i) => i.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.id.toString()).toBe(second.id);
    expect(first.id).not.toBe(second.id);
  });

  it("removing the primary image promotes the next by (sortOrder, id)", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const first = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-1.jpg",
      sortOrder: 0,
    });
    const second = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-2.jpg",
      sortOrder: 1,
    });

    await removeProductImage(admin, BigInt(first.id));

    const remaining = await db.productImage.findUniqueOrThrow({
      where: { id: BigInt(second.id) },
    });
    expect(remaining.isPrimary).toBe(true);
  });

  it("removing a non-primary image never disturbs the existing primary", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const first = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-1.jpg",
    });
    const second = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-2.jpg",
    });

    await removeProductImage(admin, BigInt(second.id));

    const remaining = await db.productImage.findUniqueOrThrow({
      where: { id: BigInt(first.id) },
    });
    expect(remaining.isPrimary).toBe(true);
  });

  it("updateProductImage never touches isPrimary", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const image = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel.jpg",
    });

    const updated = await updateProductImage(admin, BigInt(image.id), {
      altText: "450W monocrystalline solar panel",
    });
    expect(updated.altText).toBe("450W monocrystalline solar panel");
    expect(updated.isPrimary).toBe(true); // unchanged
  });

  it("reorderProductImages rewrites sortOrder for the exact supplied list", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const first = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-1.jpg",
    });
    const second = await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-2.jpg",
    });

    await reorderProductImages(admin, {
      productId: BigInt(product.id),
      imageIds: [BigInt(second.id), BigInt(first.id)],
    });

    const rows = await db.productImage.findMany({
      where: { productId: BigInt(product.id) },
      orderBy: { sortOrder: "asc" },
    });
    expect(rows.map((r) => r.id.toString())).toEqual([second.id, first.id]);
  });

  it("reorderProductImages rejects a list that doesn't match the current set exactly", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-1.jpg",
    });
    await addProductImage(admin, {
      productId: BigInt(product.id),
      url: "https://cdn.example.test/panel-2.jpg",
    });

    await expect(
      reorderProductImages(admin, {
        productId: BigInt(product.id),
        imageIds: [BigInt(999_999_999)],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("catalog: product specifications", () => {
  afterAll(cleanupCatalogTestData);

  it("upsert inserts on first call, updates in place on the same normalized key", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);

    // Key normalization is a Zod-schema transform (§8), applied by the
    // Route Handler before the use-case ever runs — same convention as
    // updateVariantSchema's compareAtPriceMinor check
    // (tests/integration/catalog-variants.test.ts). Going through the
    // schema here matches how a real request actually reaches
    // `upsertProductSpecification`.
    await upsertProductSpecification(
      admin,
      upsertProductSpecificationSchema.parse({
        productId: BigInt(product.id),
        specKey: "Cell Type",
        specValue: "Monocrystalline",
      }),
    );
    await upsertProductSpecification(
      admin,
      upsertProductSpecificationSchema.parse({
        productId: BigInt(product.id),
        specKey: "cell_type", // same key, already-normalized form
        specValue: "Polycrystalline",
      }),
    );

    const specs = await db.productSpecification.findMany({
      where: { productId: BigInt(product.id) },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]?.specKey).toBe("cell_type");
    expect(specs[0]?.specValue).toBe("Polycrystalline");
  });

  it("near-duplicate spellings converge to the same normalized key, never creating two rows", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);

    await upsertProductSpecification(
      admin,
      upsertProductSpecificationSchema.parse({
        productId: BigInt(product.id),
        specKey: "Cycle Life",
        specValue: "6000 cycles",
      }),
    );
    await upsertProductSpecification(
      admin,
      upsertProductSpecificationSchema.parse({
        productId: BigInt(product.id),
        specKey: "cycle-life",
        specValue: "6500 cycles",
      }),
    );

    const specs = await db.productSpecification.findMany({
      where: { productId: BigInt(product.id), specKey: "cycle_life" },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]?.specValue).toBe("6500 cycles");
  });

  it("removeProductSpecification deletes exactly the matching (productId, specKey) row", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    await upsertProductSpecification(admin, {
      productId: BigInt(product.id),
      specKey: "warranty_terms",
      specValue: "10 years, non-transferable",
    });

    await removeProductSpecification(admin, {
      productId: BigInt(product.id),
      specKey: "warranty_terms",
    });

    const specs = await db.productSpecification.findMany({
      where: { productId: BigInt(product.id) },
    });
    expect(specs).toHaveLength(0);
  });
});
