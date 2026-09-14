import { db } from "@/lib/db";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { createBrand } from "@/src/modules/catalog/use-cases/create-brand";
import { createCategory } from "@/src/modules/catalog/use-cases/create-category";
import { createProduct } from "@/src/modules/catalog/use-cases/create-product";
import type {
  CatalogBrand,
  CatalogCategory,
  ProductDetail,
} from "@/src/modules/catalog/types";
import {
  assignSeededRole,
  cleanupTestData as cleanupAuthTestData,
  createTestUser,
  resolveTestUser,
} from "./fixtures";

/**
 * Every test-created product/brand/category `name` uses this prefix so
 * cleanup can target exactly (and only) test data, matching the auth
 * module's email-prefix convention (`tests/integration/helpers/fixtures.ts`).
 * Slugs are left to auto-derive from the name (via `slugify`), so they
 * inherit the same distinguishing prefix.
 */
const TEST_NAME_PREFIX = "Phase4Test";

let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

export function uniqueTestName(kind: string): string {
  return `${TEST_NAME_PREFIX} ${kind} ${uniqueSuffix()}`;
}

export function uniqueTestSku(): string {
  return `PHASE4TEST-SKU-${uniqueSuffix()}`;
}

/** Resolves a real, seeded-role `AuthenticatedUser` for driving catalog
 * use-cases directly in tests — reuses the auth module's own test-user
 * machinery rather than reinventing session/permission setup. */
async function createActorWithRole(
  role: "staff" | "super_admin",
): Promise<AuthenticatedUser> {
  const { email, user } = await createTestUser();
  await assignSeededRole(user.id, role);
  const { user: resolved } = await resolveTestUser(email);
  return resolved;
}

export async function createSuperAdminActor(): Promise<AuthenticatedUser> {
  return createActorWithRole("super_admin");
}

export async function createStaffActor(): Promise<AuthenticatedUser> {
  return createActorWithRole("staff");
}

export async function createCustomerActor(): Promise<AuthenticatedUser> {
  const { user } = await createTestUser();
  return user;
}

export async function createTestCategory(
  actor: AuthenticatedUser,
  overrides: {
    name?: string;
    slug?: string;
    parentId?: bigint;
    isActive?: boolean;
  } = {},
): Promise<CatalogCategory> {
  return createCategory(actor, {
    name: overrides.name ?? uniqueTestName("Category"),
    slug: overrides.slug,
    parentId: overrides.parentId,
    isActive: overrides.isActive ?? true,
  });
}

export async function createTestBrand(
  actor: AuthenticatedUser,
  overrides: { name?: string; slug?: string } = {},
): Promise<CatalogBrand> {
  return createBrand(actor, {
    name: overrides.name ?? uniqueTestName("Brand"),
    slug: overrides.slug,
  });
}

export async function createTestProduct(
  actor: AuthenticatedUser,
  overrides: {
    name?: string;
    slug?: string;
    categoryId?: bigint;
    sku?: string;
    priceMinor?: number;
    compareAtPriceMinor?: number | null;
  } = {},
): Promise<ProductDetail> {
  const categoryId =
    overrides.categoryId ?? BigInt((await createTestCategory(actor)).id);

  return createProduct(actor, {
    name: overrides.name ?? uniqueTestName("Product"),
    slug: overrides.slug,
    unitOfMeasure: "EACH",
    categoryId,
    isFeatured: false,
    variant: {
      sku: overrides.sku ?? uniqueTestSku(),
      priceMinor: overrides.priceMinor ?? 100_000,
      compareAtPriceMinor: overrides.compareAtPriceMinor,
    },
  });
}

/** Deletes test categories in dependency order (children before parents)
 * — `categories.parent_id` is `ON DELETE RESTRICT`, so a naive
 * `deleteMany` would fail on any test that built a parent/child pair for
 * cycle-detection testing (docs/PHASE_4_CATALOG_PLAN.md §5). Bounded to a
 * generous number of passes as a defensive circuit-breaker, not because
 * any real test hierarchy is expected to be that deep. */
async function deleteCategoriesRespectingHierarchy(): Promise<void> {
  for (let pass = 0; pass < 20; pass++) {
    const remaining = await db.category.findMany({
      where: { name: { startsWith: TEST_NAME_PREFIX } },
      select: { id: true },
    });
    if (remaining.length === 0) return;

    const remainingIds = remaining.map((c) => c.id);
    const referencedAsParent = await db.category.findMany({
      where: { parentId: { in: remainingIds } },
      select: { parentId: true },
    });
    const referencedParentIdStrings = new Set(
      referencedAsParent
        .map((c) => c.parentId?.toString())
        .filter((id): id is string => id !== undefined),
    );

    const deletableNow = remaining.filter(
      (c) => !referencedParentIdStrings.has(c.id.toString()),
    );
    if (deletableNow.length === 0) {
      // Shouldn't happen given the bounded test-authored depth — stop
      // rather than loop forever if it ever does.
      break;
    }

    await db.category.deleteMany({
      where: { id: { in: deletableNow.map((c) => c.id) } },
    });
  }
}

/**
 * Deletes every catalog row this test run created, matched by the
 * `Phase4Test` name prefix. `product_variants` has `ON DELETE RESTRICT`
 * from `products`, so variants are deleted before their product;
 * `product_images`/`product_specifications` cascade automatically once
 * the product itself is deleted.
 */
export async function cleanupCatalogTestData(): Promise<void> {
  const testProducts = await db.product.findMany({
    where: { name: { startsWith: TEST_NAME_PREFIX } },
    select: { id: true },
  });
  const productIds = testProducts.map((p) => p.id);

  if (productIds.length > 0) {
    const variants = await db.productVariant.findMany({
      where: { productId: { in: productIds } },
      select: { id: true },
    });
    const variantIds = variants.map((variant) => variant.id);
    if (variantIds.length > 0) {
      const inventoryItems = await db.inventoryItem.findMany({
        where: { productVariantId: { in: variantIds } },
        select: { id: true },
      });
      const inventoryItemIds = inventoryItems.map((item) => item.id);
      if (inventoryItemIds.length > 0) {
        await db.inventoryMovement.deleteMany({
          where: { inventoryItemId: { in: inventoryItemIds } },
        });
        await db.inventoryItem.deleteMany({
          where: { id: { in: inventoryItemIds } },
        });
      }
    }
    await db.productVariant.deleteMany({
      where: { productId: { in: productIds } },
    });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
  }

  await deleteCategoriesRespectingHierarchy();
  await db.brand.deleteMany({
    where: { name: { startsWith: TEST_NAME_PREFIX } },
  });

  // Actors created via createSuperAdminActor/createStaffActor/
  // createCustomerActor go through the auth module's own test-user
  // machinery (phase3-test- email prefix) — its own cleanup owns them.
  await cleanupAuthTestData();
}
