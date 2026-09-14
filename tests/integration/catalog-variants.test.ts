import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { archiveVariant } from "@/src/modules/catalog/use-cases/archive-variant";
import { createVariant } from "@/src/modules/catalog/use-cases/create-variant";
import { reactivateVariant } from "@/src/modules/catalog/use-cases/reactivate-variant";
import { reorderVariants } from "@/src/modules/catalog/use-cases/reorder-variants";
import { updateVariantSchema } from "@/src/modules/catalog/schema";
import { setDefaultVariant } from "@/src/modules/catalog/use-cases/set-default-variant";
import { updateVariant } from "@/src/modules/catalog/use-cases/update-variant";
import {
  cleanupCatalogTestData,
  createSuperAdminActor,
  createTestProduct,
  uniqueTestSku,
} from "./helpers/catalog-fixtures";

describe("catalog: variants", () => {
  afterAll(cleanupCatalogTestData);

  it("a new variant is always isDefault: false, never a side door for changing the default", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);

    const variant = await createVariant(admin, {
      productId: BigInt(product.id),
      sku: uniqueTestSku(),
      priceMinor: 200_000,
    });

    expect(variant.isDefault).toBe(false);
  });

  it("rejects a duplicate SKU with ConflictError, not a generic error", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const sharedSku = uniqueTestSku();

    await createVariant(admin, {
      productId: BigInt(product.id),
      sku: sharedSku,
      priceMinor: 100_000,
    });

    const otherProduct = await createTestProduct(admin);
    await expect(
      createVariant(admin, {
        productId: BigInt(otherProduct.id),
        sku: sharedSku,
        priceMinor: 100_000,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("updateVariant never changes isDefault/status", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);

    const updated = await updateVariant(admin, variantId, {
      priceMinor: 999_000,
    });
    expect(updated.priceMinor).toBe(999_000);
    expect(updated.isDefault).toBe(true); // unchanged — was already the default
    expect(updated.status).toBe("ACTIVE");
  });

  it("rejects compareAtPriceMinor below priceMinor at the schema layer, accepts equal", async () => {
    // Zod validation happens at the schema layer, invoked by the Route
    // Handler before the use-case ever runs (the same convention as
    // src/modules/auth/schema.ts + its use-cases, which likewise trust
    // already-validated typed input rather than re-parsing internally) —
    // so this rule is exercised via the schema directly, matching how a
    // real request actually reaches `updateVariant`.
    expect(() =>
      updateVariantSchema.parse({
        priceMinor: 100_000,
        compareAtPriceMinor: 80_000,
      }),
    ).toThrow();

    const parsed = updateVariantSchema.parse({
      priceMinor: 100_000,
      compareAtPriceMinor: 100_000,
    });

    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    const updated = await updateVariant(admin, variantId, parsed);
    expect(updated.compareAtPriceMinor).toBe(100_000);
  });

  it("setDefaultVariant performs the exact unset-then-set — exactly one default remains", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const secondVariant = await createVariant(admin, {
      productId: BigInt(product.id),
      sku: uniqueTestSku(),
      priceMinor: 150_000,
    });

    await setDefaultVariant(admin, BigInt(secondVariant.id));

    const variants = await db.productVariant.findMany({
      where: { productId: BigInt(product.id) },
    });
    const defaults = variants.filter((v) => v.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id.toString()).toBe(secondVariant.id);
  });

  it("refuses to set an ARCHIVED variant as the default", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const secondVariant = await createVariant(admin, {
      productId: BigInt(product.id),
      sku: uniqueTestSku(),
      priceMinor: 150_000,
    });
    await archiveVariant(admin, BigInt(secondVariant.id));

    await expect(
      setDefaultVariant(admin, BigInt(secondVariant.id)),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("archiving the default variant promotes a replacement from remaining ACTIVE variants", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const defaultVariantId = BigInt(product.variants[0]!.id);
    const secondVariant = await createVariant(admin, {
      productId: BigInt(product.id),
      sku: uniqueTestSku(),
      priceMinor: 150_000,
      sortOrder: 1,
    });

    await archiveVariant(admin, defaultVariantId);

    const secondVariantRow = await db.productVariant.findUniqueOrThrow({
      where: { id: BigInt(secondVariant.id) },
    });
    expect(secondVariantRow.isDefault).toBe(true);
  });

  it("archiving the last ACTIVE variant throws and leaves state unchanged", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const onlyVariantId = BigInt(product.variants[0]!.id);

    await expect(archiveVariant(admin, onlyVariantId)).rejects.toMatchObject({
      statusCode: 400,
    });

    const row = await db.productVariant.findUniqueOrThrow({
      where: { id: onlyVariantId },
    });
    expect(row.status).toBe("ACTIVE");
  });

  it("archiving an already-ARCHIVED variant is a harmless idempotent no-op", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const secondVariant = await createVariant(admin, {
      productId: BigInt(product.id),
      sku: uniqueTestSku(),
      priceMinor: 150_000,
    });

    await archiveVariant(admin, BigInt(secondVariant.id));
    await expect(
      archiveVariant(admin, BigInt(secondVariant.id)),
    ).resolves.toMatchObject({ status: "ARCHIVED" });
  });

  it("reactivateVariant moves ARCHIVED -> ACTIVE without touching isDefault", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const secondVariant = await createVariant(admin, {
      productId: BigInt(product.id),
      sku: uniqueTestSku(),
      priceMinor: 150_000,
    });
    await archiveVariant(admin, BigInt(secondVariant.id));

    const reactivated = await reactivateVariant(
      admin,
      BigInt(secondVariant.id),
    );
    expect(reactivated.status).toBe("ACTIVE");
    expect(reactivated.isDefault).toBe(false);
  });

  it("reactivateVariant is idempotent on an already-ACTIVE variant", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);

    await expect(reactivateVariant(admin, variantId)).resolves.toMatchObject({
      status: "ACTIVE",
    });
  });

  it("reorderVariants rewrites sortOrder for the exact supplied list", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const second = await createVariant(admin, {
      productId: BigInt(product.id),
      sku: uniqueTestSku(),
      priceMinor: 150_000,
    });
    const third = await createVariant(admin, {
      productId: BigInt(product.id),
      sku: uniqueTestSku(),
      priceMinor: 150_000,
    });
    const firstId = BigInt(product.variants[0]!.id);

    await reorderVariants(admin, {
      productId: BigInt(product.id),
      variantIds: [BigInt(third.id), firstId, BigInt(second.id)],
    });

    const rows = await db.productVariant.findMany({
      where: { productId: BigInt(product.id) },
      orderBy: { sortOrder: "asc" },
    });
    expect(rows.map((r) => r.id.toString())).toEqual([
      third.id,
      firstId.toString(),
      second.id,
    ]);
  });

  it("reorderVariants rejects a list that omits or adds a variant", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    await createVariant(admin, {
      productId: BigInt(product.id),
      sku: uniqueTestSku(),
      priceMinor: 150_000,
    });

    await expect(
      reorderVariants(admin, {
        productId: BigInt(product.id),
        variantIds: [BigInt(product.variants[0]!.id)], // missing the second variant
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
