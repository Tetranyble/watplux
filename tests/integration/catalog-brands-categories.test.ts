import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { activateBrand } from "@/src/modules/catalog/use-cases/activate-brand";
import { activateCategory } from "@/src/modules/catalog/use-cases/activate-category";
import { createBrand } from "@/src/modules/catalog/use-cases/create-brand";
import { deactivateBrand } from "@/src/modules/catalog/use-cases/deactivate-brand";
import { deactivateCategory } from "@/src/modules/catalog/use-cases/deactivate-category";
import { getCategoryTree } from "@/src/modules/catalog/use-cases/get-category-tree";
import { listBrands } from "@/src/modules/catalog/use-cases/list-brands";
import { reorderCategories } from "@/src/modules/catalog/use-cases/reorder-categories";
import { updateBrand } from "@/src/modules/catalog/use-cases/update-brand";
import { updateCategory } from "@/src/modules/catalog/use-cases/update-category";
import {
  cleanupCatalogTestData,
  createSuperAdminActor,
  createTestBrand,
  createTestCategory,
  uniqueTestName,
} from "./helpers/catalog-fixtures";

describe("catalog: brands", () => {
  afterAll(cleanupCatalogTestData);

  it("auto-derives a slug from the name when none is supplied", async () => {
    const admin = await createSuperAdminActor();
    const name = uniqueTestName("AutoSlugBrand");
    const brand = await createBrand(admin, { name });
    expect(brand.slug).toContain("autoslugbrand");
  });

  it("auto-generated slug collisions get a numeric suffix, not a rejection", async () => {
    const admin = await createSuperAdminActor();
    const name = uniqueTestName("DupBrandName");
    const first = await createBrand(admin, { name });
    const second = await createBrand(admin, { name });
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug.startsWith(first.slug)).toBe(true);
  });

  it("an explicit slug conflict returns ConflictError and never silently suffixes", async () => {
    const admin = await createSuperAdminActor();
    const explicitSlug = `phase4test-explicit-brand-${Date.now()}`;
    await createBrand(admin, {
      name: uniqueTestName("ExplicitA"),
      slug: explicitSlug,
    });

    await expect(
      createBrand(admin, {
        name: uniqueTestName("ExplicitB"),
        slug: explicitSlug,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const matching = await db.brand.findMany({ where: { slug: explicitSlug } });
    expect(matching).toHaveLength(1);
  });

  it("deactivate/activate toggles isActive", async () => {
    const admin = await createSuperAdminActor();
    const brand = await createTestBrand(admin);

    const deactivated = await deactivateBrand(admin, BigInt(brand.id));
    expect(deactivated.isActive).toBe(false);

    const reactivated = await activateBrand(admin, BigInt(brand.id));
    expect(reactivated.isActive).toBe(true);
  });

  it("update can change name/logoUrl without touching slug when no name/slug change is requested", async () => {
    const admin = await createSuperAdminActor();
    const brand = await createTestBrand(admin);

    const updated = await updateBrand(admin, BigInt(brand.id), {
      logoUrl: "https://cdn.example.test/brand-logo.png",
    });
    expect(updated.slug).toBe(brand.slug);
    expect(updated.logoUrl).toBe("https://cdn.example.test/brand-logo.png");
  });

  it("listBrands (public) only returns active brands", async () => {
    const admin = await createSuperAdminActor();
    const activeBrand = await createTestBrand(admin);
    const inactiveBrand = await createTestBrand(admin);
    await deactivateBrand(admin, BigInt(inactiveBrand.id));

    const publicBrands = await listBrands();
    const ids = publicBrands.map((b) => b.id);
    expect(ids).toContain(activeBrand.id);
    expect(ids).not.toContain(inactiveBrand.id);
  });
});

describe("catalog: categories", () => {
  afterAll(cleanupCatalogTestData);

  it("creates a root category with no parent", async () => {
    const admin = await createSuperAdminActor();
    const category = await createTestCategory(admin);
    expect(category.parentId).toBeNull();
  });

  it("creates a valid parent/child relationship", async () => {
    const admin = await createSuperAdminActor();
    const parent = await createTestCategory(admin);
    const child = await createTestCategory(admin, {
      parentId: BigInt(parent.id),
    });
    expect(child.parentId).toBe(parent.id);
  });

  it("rejects a self-parenting reparent", async () => {
    const admin = await createSuperAdminActor();
    const category = await createTestCategory(admin);

    await expect(
      updateCategory(admin, BigInt(category.id), {
        parentId: BigInt(category.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a reparent that would create a multi-level cycle", async () => {
    const admin = await createSuperAdminActor();
    const grandparent = await createTestCategory(admin);
    const parent = await createTestCategory(admin, {
      parentId: BigInt(grandparent.id),
    });
    const child = await createTestCategory(admin, {
      parentId: BigInt(parent.id),
    });

    // Attempt to make the grandparent a child of its own grandchild.
    await expect(
      updateCategory(admin, BigInt(grandparent.id), {
        parentId: BigInt(child.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("allows a valid reparent that does not create a cycle", async () => {
    const admin = await createSuperAdminActor();
    const categoryA = await createTestCategory(admin);
    const categoryB = await createTestCategory(admin);

    const updated = await updateCategory(admin, BigInt(categoryB.id), {
      parentId: BigInt(categoryA.id),
    });
    expect(updated.parentId).toBe(categoryA.id);
  });

  it("auto-generated slug collisions get a numeric suffix", async () => {
    const admin = await createSuperAdminActor();
    const name = uniqueTestName("DupCategoryName");
    const first = await createTestCategory(admin, { name });
    const second = await createTestCategory(admin, { name });
    expect(second.slug).not.toBe(first.slug);
  });

  it("an explicit slug conflict returns ConflictError, existing row unchanged", async () => {
    const admin = await createSuperAdminActor();
    const explicitSlug = `phase4test-explicit-category-${Date.now()}`;
    await createTestCategory(admin, { slug: explicitSlug });

    await expect(
      createTestCategory(admin, { slug: explicitSlug }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const matching = await db.category.findMany({
      where: { slug: explicitSlug },
    });
    expect(matching).toHaveLength(1);
  });

  it("deactivate/activate does not cascade to children", async () => {
    const admin = await createSuperAdminActor();
    const parent = await createTestCategory(admin);
    const child = await createTestCategory(admin, {
      parentId: BigInt(parent.id),
    });

    await deactivateCategory(admin, BigInt(parent.id));

    const childRow = await db.category.findUniqueOrThrow({
      where: { id: BigInt(child.id) },
    });
    expect(childRow.isActive).toBe(true); // untouched

    await activateCategory(admin, BigInt(parent.id));
  });

  it("reorderCategories rewrites sortOrder for the exact sibling set", async () => {
    const admin = await createSuperAdminActor();
    const parent = await createTestCategory(admin);
    const childA = await createTestCategory(admin, {
      parentId: BigInt(parent.id),
    });
    const childB = await createTestCategory(admin, {
      parentId: BigInt(parent.id),
    });

    await reorderCategories(admin, {
      parentId: BigInt(parent.id),
      categoryIds: [BigInt(childB.id), BigInt(childA.id)],
    });

    const rows = await db.category.findMany({
      where: { parentId: BigInt(parent.id) },
      orderBy: { sortOrder: "asc" },
    });
    expect(rows.map((r) => r.id.toString())).toEqual([childB.id, childA.id]);
  });

  it("getCategoryTree (public) only includes active categories, nested correctly", async () => {
    const admin = await createSuperAdminActor();
    const parent = await createTestCategory(admin);
    const activeChild = await createTestCategory(admin, {
      parentId: BigInt(parent.id),
    });
    const inactiveChild = await createTestCategory(admin, {
      parentId: BigInt(parent.id),
      isActive: false,
    });

    const tree = await getCategoryTree();
    const parentNode = tree.find((n) => n.id === parent.id);
    expect(parentNode).toBeDefined();
    const childIds = parentNode?.children.map((c) => c.id) ?? [];
    expect(childIds).toContain(activeChild.id);
    expect(childIds).not.toContain(inactiveChild.id);
  });
});
