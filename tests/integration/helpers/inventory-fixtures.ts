import { db } from "@/lib/db";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import type { ProductDetail } from "@/src/modules/catalog/types";
import { createTestProduct, uniqueTestName } from "./catalog-fixtures";

/**
 * Every test-created Order uses this `orderNumber` prefix so cleanup can
 * target exactly (and only) test data — same convention as
 * `catalog-fixtures.ts`'s `Phase4Test` name prefix and `fixtures.ts`'s
 * `phase3-test-` email prefix. `orders.order_number` is `@db.VarChar(30)`
 * (docs/DATABASE_DESIGN.md), so the prefix + suffix must stay well under
 * that — base36-encoding the timestamp keeps it short.
 */
const TEST_ORDER_NUMBER_PREFIX = "P5T-";

let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

export function uniqueTestOrderNumber(): string {
  return `${TEST_ORDER_NUMBER_PREFIX}${uniqueSuffix()}`;
}

/**
 * There is no Order module yet (Phase 5 is Inventory-only — the inventory
 * module's inter-module contracts take a bare `orderItemId`, never an
 * actor or an Order-module use-case call). Order/OrderItem rows needed to
 * drive `reserveInventory`/`releaseInventory`/`completeInventorySale` and
 * the mandatory order-item/variant mismatch tests are therefore created
 * directly via Prisma, matching `docs/DATABASE_DESIGN.md`'s `orders`/
 * `order_items` schema exactly (not an illustrative/simplified shape).
 */
export async function createTestOrderWithItem(
  actor: AuthenticatedUser,
  overrides: {
    product?: ProductDetail;
    quantity?: string;
    unitPriceMinor?: number;
  } = {},
): Promise<{ orderId: bigint; orderItemId: bigint; variantId: bigint }> {
  const product = overrides.product ?? (await createTestProduct(actor));
  const variant = product.variants[0];
  if (!variant) {
    throw new Error("createTestProduct must always create a default variant");
  }
  const variantId = BigInt(variant.id);
  const quantity = overrides.quantity ?? "1";
  const unitPriceMinor = overrides.unitPriceMinor ?? variant.priceMinor;
  const lineTotalMinor = Math.round(Number(quantity) * unitPriceMinor);

  const order = await db.order.create({
    data: {
      orderNumber: uniqueTestOrderNumber(),
      userId: BigInt(actor.id),
      status: "PENDING_PAYMENT",
      subtotalMinor: lineTotalMinor,
      totalMinor: lineTotalMinor,
      items: {
        create: {
          productId: BigInt(product.id),
          productVariantId: variantId,
          productNameSnapshot: product.name,
          skuSnapshot: variant.sku,
          unitPriceMinor,
          quantity,
          lineTotalMinor,
        },
      },
    },
    include: { items: true },
  });

  const orderItem = order.items[0];
  if (!orderItem) {
    throw new Error("Order create with nested item must return the item");
  }

  return { orderId: order.id, orderItemId: orderItem.id, variantId };
}

/**
 * Builds a second, independent product+variant+order-item — used for the
 * mandatory "order item belongs to a different variant" mismatch test
 * (user's critical correction: the FK on `inventory_movements.order_item_id`
 * only proves the order item exists, not that it names the same variant as
 * the inventory item being mutated).
 */
export async function createTestOrderItemForDifferentVariant(
  actor: AuthenticatedUser,
): Promise<{ orderItemId: bigint; variantId: bigint }> {
  const { orderItemId, variantId } = await createTestOrderWithItem(actor);
  return { orderItemId, variantId };
}

/** Deletes every Order (and cascaded OrderItem) this test run created,
 * matched by the `PHASE5TEST-ORD-` order-number prefix. Inventory rows
 * (`inventory_items`/`inventory_movements`) are cleaned up by
 * `cleanupInventoryTestData` in the caller, which must run BEFORE this —
 * `inventory_movements.order_item_id` is `onDelete: Restrict`. */
export async function cleanupTestOrders(): Promise<void> {
  await db.order.deleteMany({
    where: { orderNumber: { startsWith: TEST_ORDER_NUMBER_PREFIX } },
  });
}

/** Deletes every `inventory_items`/`inventory_movements` row created for
 * test products (matched via the `Phase4Test` product-name prefix that
 * `createTestProduct` uses), plus any test orders/order-items that
 * reference them. Must run BEFORE `cleanupCatalogTestData()`, since
 * `inventory_items.product_variant_id` is `onDelete: Restrict`. */
export async function cleanupInventoryTestData(): Promise<void> {
  const testProducts = await db.product.findMany({
    where: { name: { startsWith: "Phase4Test" } },
    select: { id: true, variants: { select: { id: true } } },
  });
  const variantIds = testProducts.flatMap((p) => p.variants.map((v) => v.id));

  if (variantIds.length > 0) {
    const items = await db.inventoryItem.findMany({
      where: { productVariantId: { in: variantIds } },
      select: { id: true },
    });
    const itemIds = items.map((i) => i.id);

    if (itemIds.length > 0) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItemId: { in: itemIds } },
      });
      await db.inventoryItem.deleteMany({
        where: { id: { in: itemIds } },
      });
    }
  }

  await cleanupTestOrders();
}

export { uniqueTestName };
