import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";
import { generateOrderNumber } from "@/src/modules/order/order-number";
import * as orderRepo from "@/src/modules/order/repo";
import { createOrder } from "@/src/modules/order/use-cases/create-order";
import {
  cleanupCatalogTestData,
  createSuperAdminActor,
} from "./helpers/catalog-fixtures";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";
import {
  buildCreateOrderInput,
  cleanupOrderTestData,
  createStockedProduct,
  createTestOrder,
} from "./helpers/order-fixtures";

/**
 * Order creation and initial inventory reservation are one atomic
 * transaction (docs/PHASE_6_ORDER_PLAN.md §5/§7) — every test here
 * inspects the real database directly, never inferring correctness from
 * a promise resolving/rejecting alone.
 */
describe("order: creation", () => {
  afterAll(async () => {
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("happy path: order + items + addresses + reservation all committed together", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 10 });

    const order = await createTestOrder(admin, variantId, { quantity: 3 });

    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.items).toHaveLength(1);
    expect(order.items[0]!.quantity).toBe(3);
    expect(order.addresses).toHaveLength(1);
    expect(order.addresses[0]!.type).toBe("SHIPPING");
    expect(order.statusHistory).toHaveLength(1);
    expect(order.statusHistory[0]!.toStatus).toBe("PENDING_PAYMENT");
    expect(order.statusHistory[0]!.fromStatus).toBe("");

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(10);
    expect(balance.quantityReserved).toBe(3);
    expect(balance.quantityAvailable).toBe(7);

    const reserveMovements = await db.inventoryMovement.findMany({
      where: {
        orderItemId: BigInt(order.items[0]!.id),
        type: "RESERVE",
      },
    });
    expect(reserveMovements).toHaveLength(1);
  });

  it("insufficient inventory rolls back the ENTIRE transaction — no order, no order_items, no order_addresses, no reservation, no history row survives", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 2 });

    const ordersBefore = await db.order.count();

    await expect(
      createTestOrder(admin, variantId, { quantity: 5 }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const ordersAfter = await db.order.count();
    expect(ordersAfter).toBe(ordersBefore);

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(2);
    expect(balance.quantityReserved).toBe(0);

    const movements = await db.inventoryMovement.findMany({
      where: { inventoryItem: { productVariantId: variantId } },
    });
    // Only the RESTOCK movement from setup — no RESERVE was ever inserted.
    expect(movements.map((m) => m.type)).toEqual(["RESTOCK"]);
  });

  it("immutable snapshot values survive a later product/variant price edit unchanged", async () => {
    const admin = await createSuperAdminActor();
    const { product, variantId } = await createStockedProduct(admin, {
      quantity: 10,
      priceMinor: 200_000,
    });

    const order = await createTestOrder(admin, variantId, { quantity: 1 });
    expect(order.items[0]!.unitPriceMinor).toBe(200_000);

    // Change the variant's live price directly (bypassing the use-case
    // layer is fine here — the point is simulating "price changed later").
    await db.productVariant.update({
      where: { id: variantId },
      data: { priceMinor: 999_000 },
    });

    const reFetched = await orderRepo.findOrderById(BigInt(order.id));
    expect(reFetched!.items[0]!.unitPriceMinor).toBe(200_000);
    expect(reFetched!.items[0]!.productNameSnapshot).toBe(product.name);
  });

  it("rejects guest checkout with no guestEmail", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    await expect(
      createOrder(null, buildCreateOrderInput(variantId)),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepts guest checkout with a guestEmail, userId is null", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const order = await createOrder(
      null,
      buildCreateOrderInput(variantId, { guestEmail: "guest@example.test" }),
    );
    expect(order.userId).toBeNull();
  });

  it("rejects a duplicate variantId within the same order", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 10 });

    await expect(
      createOrder(admin, {
        lines: [
          { variantId, quantity: 1 },
          { variantId, quantity: 2 },
        ],
        shippingAddress: buildCreateOrderInput(variantId).shippingAddress,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("creates a billing address row only when explicitly supplied", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const withoutBilling = await createTestOrder(admin, variantId);
    expect(withoutBilling.addresses).toHaveLength(1);

    const { variantId: variantId2 } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const withBilling = await createTestOrder(admin, variantId2, {
      billingAddress: true,
    });
    expect(withBilling.addresses).toHaveLength(2);
    expect(withBilling.addresses.map((a) => a.type).sort()).toEqual([
      "BILLING",
      "SHIPPING",
    ]);
  });

  it("computed totals satisfy the exact chk_orders_total_arithmetic formula", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 10,
      priceMinor: 150_000,
    });

    const order = await createTestOrder(admin, variantId, { quantity: 2 });
    expect(order.subtotalMinor).toBe(300_000);
    expect(
      order.subtotalMinor -
        order.discountMinor +
        order.deliveryFeeMinor +
        order.taxMinor,
    ).toBe(order.totalMinor);
  });

  it(
    "MANDATORY ROLLBACK PROOF: a failure injected after inventory reservation succeeds but before " +
      "the transaction commits rolls back EVERYTHING — no order, no order_items, no order_addresses, " +
      "no reservation, no status-history row survives",
    async () => {
      const admin = await createSuperAdminActor();
      const { variantId } = await createStockedProduct(admin, {
        quantity: 10,
      });
      const resolved = await orderRepo.resolveOrderLine(variantId);
      const orderNumber = generateOrderNumber();

      // A genuinely nonexistent user id — the LAST statement in
      // `createOrder`'s transaction (inserting `order_status_history`,
      // which happens strictly AFTER the inventory reservation step) has
      // a real FK to `users.id`; this forces MySQL to reject exactly
      // that final statement, which is deliberately injected here to run
      // after reservation has already (within the transaction) applied
      // its guarded UPDATE + INSERT.
      const nonexistentActorId = BigInt("999999999999");

      await expect(
        orderRepo.createOrder({
          orderNumber,
          userId: null,
          guestEmail: "rollback-proof@example.test",
          guestPhone: null,
          customerNote: null,
          subtotalMinor: resolved.unitPriceMinor,
          discountMinor: 0,
          deliveryFeeMinor: 0,
          taxMinor: 0,
          totalMinor: resolved.unitPriceMinor,
          currency: "NGN",
          lines: [
            {
              variantId: resolved.variantId,
              productId: resolved.productId,
              productNameSnapshot: resolved.productNameSnapshot,
              skuSnapshot: resolved.skuSnapshot,
              variantLabelSnapshot: resolved.variantLabelSnapshot,
              unitPriceMinor: resolved.unitPriceMinor,
              quantity: new Prisma.Decimal(1),
              discountMinor: 0,
              taxMinor: 0,
              lineTotalMinor: resolved.unitPriceMinor,
            },
          ],
          shippingAddress: {
            type: "SHIPPING",
            fullName: "Rollback Proof",
            phone: "+2348000000000",
            addressLine1: "1 Rollback Street",
            addressLine2: null,
            city: "Lagos",
            state: "Lagos",
            country: "NG",
            postalCode: null,
            deliveryNotes: null,
          },
          billingAddress: null,
          initialActorId: nonexistentActorId,
        }),
      ).rejects.toThrow();

      // Direct, fresh database re-reads — never inferred from the
      // rejection alone.
      const survivingOrder = await db.order.findUnique({
        where: { orderNumber },
      });
      expect(survivingOrder).toBeNull();

      const balance = await getInventoryForVariant(admin, variantId);
      expect(balance.quantityOnHand).toBe(10);
      expect(balance.quantityReserved).toBe(0);
      expect(balance.quantityAvailable).toBe(10);

      const movements = await db.inventoryMovement.findMany({
        where: { inventoryItem: { productVariantId: variantId } },
      });
      // Only the RESTOCK from setup — the RESERVE this test attempted was
      // fully rolled back along with everything else.
      expect(movements.map((m) => m.type)).toEqual(["RESTOCK"]);
    },
  );
});
