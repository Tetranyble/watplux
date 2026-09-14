import { db } from "@/lib/db";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import type { ProductDetail } from "@/src/modules/catalog/types";
import { restockInventory } from "@/src/modules/inventory/use-cases/restock-inventory";
import { createOrder } from "@/src/modules/order/use-cases/create-order";
import type { CreateOrderInput } from "@/src/modules/order/schema";
import type { OrderDetail } from "@/src/modules/order/types";
import { createTestProduct } from "./catalog-fixtures";

/**
 * Creates a `Phase4Test`-prefixed product+variant AND restocks it via the
 * real Inventory use-case (not a raw Prisma insert — exercising the same
 * path production checkout would), ready for order-creation tests.
 */
export async function createStockedProduct(
  admin: AuthenticatedUser,
  overrides: { quantity?: number; priceMinor?: number } = {},
): Promise<{ product: ProductDetail; variantId: bigint }> {
  const product = await createTestProduct(admin, {
    priceMinor: overrides.priceMinor ?? 100_000,
  });
  const variantId = BigInt(product.variants[0]!.id);
  await restockInventory(admin, variantId, {
    quantity: overrides.quantity ?? 10,
  });
  return { product, variantId };
}

export function buildCreateOrderInput(
  variantId: bigint,
  overrides: {
    quantity?: number;
    guestEmail?: string;
    customerNote?: string;
    billingAddress?: boolean;
  } = {},
): CreateOrderInput {
  return {
    lines: [{ variantId, quantity: overrides.quantity ?? 1 }],
    shippingAddress: {
      fullName: "Test Customer",
      phone: "+2348012345678",
      addressLine1: "1 Test Street",
      city: "Lagos",
      state: "Lagos",
      country: "NG",
    },
    billingAddress: overrides.billingAddress
      ? {
          fullName: "Test Billing Contact",
          phone: "+2348012345679",
          addressLine1: "2 Billing Avenue",
          city: "Abuja",
          state: "FCT",
          country: "NG",
        }
      : undefined,
    guestEmail: overrides.guestEmail,
    customerNote: overrides.customerNote,
  };
}

/** Creates a real order via the actual `createOrder` use-case (never a
 * raw Prisma insert) — for a customer actor by default. */
export async function createTestOrder(
  actor: AuthenticatedUser | null,
  variantId: bigint,
  overrides: Parameters<typeof buildCreateOrderInput>[1] = {},
): Promise<OrderDetail> {
  return createOrder(actor, buildCreateOrderInput(variantId, overrides));
}

let paymentAttemptCounter = 0;

/**
 * `payment_attempts` rows created directly via Prisma — there is no
 * Payment module yet (Phase 6 is Order-only), matching exactly how
 * Phase 5's own tests created `order_items` directly before the Order
 * module existed. Used only to test `markOrderPaid`'s contract and
 * order-cancellation-conflict scenarios against a real,
 * schema-accurate `payment_attempts` row — not a simplified stand-in.
 */
export async function createTestPaymentAttempt(
  orderId: bigint,
  overrides: {
    status?: "INITIATED" | "PENDING" | "SUCCESS" | "FAILED";
    amountMinor?: number;
  } = {},
): Promise<{ id: bigint }> {
  paymentAttemptCounter += 1;
  const paymentAttempt = await db.paymentAttempt.create({
    data: {
      orderId,
      paystackReference: `PHASE6TEST-REF-${Date.now()}-${paymentAttemptCounter}`,
      amountMinor: overrides.amountMinor ?? 100_000,
      status: overrides.status ?? "SUCCESS",
    },
  });
  return { id: paymentAttempt.id };
}

/**
 * Deletes every order this test run created, matched transitively via the
 * `Phase4Test` product-name prefix (order numbers are randomly generated
 * — see `src/modules/order/order-number.ts` — so there is no order-level
 * prefix to match against directly). `inventory_movements` referencing
 * these orders' `order_items`, and any `payment_attempts` referencing
 * these orders, must both be removed first (`inventory_movements.order_item_id`
 * and `payment_attempts.order_id` are both `ON DELETE RESTRICT`);
 * `order_items`/`order_addresses`/`order_status_history` all cascade
 * automatically once the `orders` row itself is deleted.
 *
 * Must run BEFORE `cleanupInventoryTestData()`/`cleanupCatalogTestData()`.
 */
export async function cleanupOrderTestData(): Promise<void> {
  const testOrders = await db.order.findMany({
    where: {
      items: { some: { product: { name: { startsWith: "Phase4Test" } } } },
    },
    select: { id: true, items: { select: { id: true } } },
  });

  const orderIds = testOrders.map((o) => o.id);
  const orderItemIds = testOrders.flatMap((o) => o.items.map((i) => i.id));

  if (orderItemIds.length > 0) {
    await db.inventoryMovement.deleteMany({
      where: { orderItemId: { in: orderItemIds } },
    });
  }
  if (orderIds.length > 0) {
    // Clear the authoritative-payment-attempt pointer first — it's a
    // separate unique FK column on `orders`, independent of the
    // payment_attempts.order_id FK below, and would otherwise block
    // deleting the payment_attempts row it points to.
    await db.order.updateMany({
      where: { id: { in: orderIds } },
      data: { authoritativePaymentAttemptId: null },
    });
    await db.paymentAttempt.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
  }
}
