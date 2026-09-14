import { afterAll, describe, expect, it } from "vitest";

import { archiveProduct } from "@/src/modules/catalog/use-cases/archive-product";
import { archiveVariant } from "@/src/modules/catalog/use-cases/archive-variant";
import { createBrand } from "@/src/modules/catalog/use-cases/create-brand";
import { createCategory } from "@/src/modules/catalog/use-cases/create-category";
import { createProduct } from "@/src/modules/catalog/use-cases/create-product";
import { createVariant } from "@/src/modules/catalog/use-cases/create-variant";
import { deactivateCategory } from "@/src/modules/catalog/use-cases/deactivate-category";
import { getProductForAdmin } from "@/src/modules/catalog/use-cases/get-product-for-admin";
import { listProductsForAdmin } from "@/src/modules/catalog/use-cases/list-products-for-admin";
import { listProductsForAdminSchema } from "@/src/modules/catalog/schema";
import { publishProduct } from "@/src/modules/catalog/use-cases/publish-product";
import { reactivateVariant } from "@/src/modules/catalog/use-cases/reactivate-variant";
import { setDefaultVariant } from "@/src/modules/catalog/use-cases/set-default-variant";
import { softDeleteProduct } from "@/src/modules/catalog/use-cases/soft-delete-product";
import { updateBrand } from "@/src/modules/catalog/use-cases/update-brand";
import { updateProduct } from "@/src/modules/catalog/use-cases/update-product";
import { updateVariant } from "@/src/modules/catalog/use-cases/update-variant";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createStaffActor,
  createSuperAdminActor,
  createTestBrand,
  createTestCategory,
  createTestProduct,
  uniqueTestSku,
} from "./helpers/catalog-fixtures";

describe("catalog: authorization", () => {
  afterAll(cleanupCatalogTestData);

  it("a customer (zero permissions) cannot create a product", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const category = await createTestCategory(admin);

    await expect(
      createProduct(customer, {
        name: "Should Not Be Created",
        unitOfMeasure: "EACH",
        categoryId: BigInt(category.id),
        isFeatured: false,
        variant: { sku: uniqueTestSku(), priceMinor: 100_000 },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a customer cannot update, publish, archive, or soft-delete a product", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const product = await createTestProduct(admin);

    await expect(
      updateProduct(customer, BigInt(product.id), { name: "Hacked" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      publishProduct(customer, BigInt(product.id)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      archiveProduct(customer, BigInt(product.id)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      softDeleteProduct(customer, BigInt(product.id)),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a customer cannot create, update, set-default, archive, or reactivate a variant", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);

    await expect(
      createVariant(customer, {
        productId: BigInt(product.id),
        sku: uniqueTestSku(),
        priceMinor: 100_000,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      updateVariant(customer, variantId, { priceMinor: 1 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(setDefaultVariant(customer, variantId)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(archiveVariant(customer, variantId)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(reactivateVariant(customer, variantId)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("a customer cannot create/update a brand or category", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const brand = await createTestBrand(admin);

    await expect(
      createBrand(customer, { name: "Hacked Brand" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      updateBrand(customer, BigInt(brand.id), { name: "Hacked" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      createCategory(customer, {
        name: "Hacked Category",
        isActive: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const category = await createTestCategory(admin);
    await expect(
      deactivateCategory(customer, BigInt(category.id)),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("staff (products.read only) can read via the admin path but cannot mutate", async () => {
    const admin = await createSuperAdminActor();
    const staff = await createStaffActor();
    const product = await createTestProduct(admin);

    await expect(
      getProductForAdmin(staff, BigInt(product.id)),
    ).resolves.toMatchObject({ id: product.id });
    await expect(
      listProductsForAdmin(staff, listProductsForAdminSchema.parse({})),
    ).resolves.toMatchObject({ items: expect.any(Array) });

    await expect(
      updateProduct(staff, BigInt(product.id), {
        name: "Staff Should Not Do This",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      publishProduct(staff, BigInt(product.id)),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a customer cannot read via the admin path either (products.read required)", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const product = await createTestProduct(admin);

    await expect(
      getProductForAdmin(customer, BigInt(product.id)),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("super_admin can perform every privileged catalog operation end-to-end", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);

    await expect(
      updateProduct(admin, BigInt(product.id), { isFeatured: true }),
    ).resolves.toMatchObject({ isFeatured: true });
    await expect(
      publishProduct(admin, BigInt(product.id)),
    ).resolves.toMatchObject({ status: "ACTIVE" });
    await expect(
      archiveProduct(admin, BigInt(product.id)),
    ).resolves.toMatchObject({ status: "ARCHIVED" });
    await expect(
      softDeleteProduct(admin, BigInt(product.id)),
    ).resolves.toMatchObject({ deletedAt: expect.any(String) });
  });

  it("a forged actor-shaped object cannot substitute for a real session-resolved AuthenticatedUser", async () => {
    // There is no code path in any catalog use-case that accepts
    // permissions from anything other than the `actor` object itself —
    // demonstrating that a plain object literal claiming elevated
    // permissions, constructed here exactly as an attacker forging a
    // request body might attempt, is still just data: it only "works"
    // because we're calling the use-case directly in-process with it,
    // which is never possible over real HTTP (the Route Handler always
    // resolves `actor` itself via `requireSessionUser()`, ignoring
    // anything in the request body — verified at the HTTP layer in
    // tests/e2e/catalog.spec.ts). This test documents that the use-case's
    // ONLY authorization input is the `permissions` set on the actor
    // object it's given — there is no secondary field (role name, id,
    // email) it additionally trusts.
    const forgedActor = {
      id: BigInt(999_999_999),
      email: "forged@example.test",
      name: "Forged Admin",
      status: "ACTIVE" as const,
      permissions: new Set<string>(), // the actual, real permission set — empty
    };

    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);

    await expect(
      updateProduct(forgedActor, BigInt(product.id), { name: "Forged" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
