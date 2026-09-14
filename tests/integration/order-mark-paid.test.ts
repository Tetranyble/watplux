import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";
import { cancelOrder } from "@/src/modules/order/use-cases/cancel-order";
import { markOrderPaid } from "@/src/modules/order/use-cases/mark-order-paid";
import {
  cleanupCatalogTestData,
  createSuperAdminActor,
} from "./helpers/catalog-fixtures";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";
import {
  cleanupOrderTestData,
  createStockedProduct,
  createTestOrder,
  createTestPaymentAttempt,
} from "./helpers/order-fixtures";

/**
 * `markOrderPaid` — the inter-module contract (docs/PHASE_6_ORDER_PLAN.md
 * §8). Includes the MANDATORY payment-attempt/order mismatch tests added
 * during implementation approval, mirroring Phase 5's own mandatory
 * order-item/variant mismatch tests exactly.
 */
describe("order: markOrderPaid (inter-module contract)", () => {
  afterAll(async () => {
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("[MANDATORY 1/4] a valid, matching, SUCCESS payment attempt transitions the order to PAID and converts RESERVE -> SALE", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 10 });
    const order = await createTestOrder(admin, variantId, { quantity: 4 });
    const paymentAttempt = await createTestPaymentAttempt(BigInt(order.id));

    const result = await markOrderPaid({
      orderId: BigInt(order.id),
      paymentAttemptId: paymentAttempt.id,
    });

    expect(result.transitioned).toBe(true);
    expect(result.order.status).toBe("PAID");
    expect(result.order.authoritativePaymentAttemptId).toBe(
      paymentAttempt.id.toString(),
    );

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(6);
    expect(balance.quantityReserved).toBe(0);

    const saleMovements = await db.inventoryMovement.findMany({
      where: { orderItemId: BigInt(order.items[0]!.id), type: "SALE" },
    });
    expect(saleMovements).toHaveLength(1);

    const historyRows = await db.orderStatusHistory.findMany({
      where: { orderId: BigInt(order.id) },
      orderBy: { id: "asc" },
    });
    expect(historyRows.map((h) => h.toStatus)).toEqual([
      "PENDING_PAYMENT",
      "PAID",
    ]);
    expect(historyRows[1]!.actorType).toBe("WEBHOOK");
    expect(historyRows[1]!.actorId).toBeNull();
  });

  it("[MANDATORY 2/4] a nonexistent payment attempt is rejected, without changing the order", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(admin, variantId, { quantity: 1 });

    await expect(
      markOrderPaid({
        orderId: BigInt(order.id),
        paymentAttemptId: BigInt("999999999999"),
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const unchanged = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(unchanged.status).toBe("PENDING_PAYMENT");
  });

  it(
    "[MANDATORY 3/4] a payment attempt that genuinely exists and is SUCCESS but belongs to a " +
      "DIFFERENT order is rejected, without changing either order's state or inventory",
    async () => {
      const admin = await createSuperAdminActor();

      const { variantId: variantAId } = await createStockedProduct(admin, {
        quantity: 10,
      });
      const orderA = await createTestOrder(admin, variantAId, { quantity: 2 });

      const { variantId: variantBId } = await createStockedProduct(admin, {
        quantity: 10,
      });
      const orderB = await createTestOrder(admin, variantBId, { quantity: 3 });
      const paymentAttemptForB = await createTestPaymentAttempt(
        BigInt(orderB.id),
      );

      // Attempt to mark Order A paid using Order B's payment attempt.
      await expect(
        markOrderPaid({
          orderId: BigInt(orderA.id),
          paymentAttemptId: paymentAttemptForB.id,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      const orderAAfter = await db.order.findUniqueOrThrow({
        where: { id: BigInt(orderA.id) },
      });
      const orderBAfter = await db.order.findUniqueOrThrow({
        where: { id: BigInt(orderB.id) },
      });
      expect(orderAAfter.status).toBe("PENDING_PAYMENT");
      expect(orderBAfter.status).toBe("PENDING_PAYMENT");
      expect(orderAAfter.authoritativePaymentAttemptId).toBeNull();

      const balanceA = await getInventoryForVariant(admin, variantAId);
      const balanceB = await getInventoryForVariant(admin, variantBId);
      expect(balanceA.quantityReserved).toBe(2);
      expect(balanceA.quantityOnHand).toBe(10);
      expect(balanceB.quantityReserved).toBe(3);
      expect(balanceB.quantityOnHand).toBe(10);

      const saleMovements = await db.inventoryMovement.findMany({
        where: { type: "SALE", orderItemId: BigInt(orderA.items[0]!.id) },
      });
      expect(saleMovements).toHaveLength(0);
    },
  );

  it("[MANDATORY 4/4] a payment attempt belonging to the order but not yet SUCCESS is rejected, without changing the order", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(admin, variantId, { quantity: 1 });
    const paymentAttempt = await createTestPaymentAttempt(BigInt(order.id), {
      status: "PENDING",
    });

    await expect(
      markOrderPaid({
        orderId: BigInt(order.id),
        paymentAttemptId: paymentAttempt.id,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const unchanged = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(unchanged.status).toBe("PENDING_PAYMENT");
  });

  it("a duplicate markOrderPaid call for an already-PAID order returns transitioned: false, does not re-run SALE", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 8 });
    const order = await createTestOrder(admin, variantId, { quantity: 2 });
    const paymentAttempt = await createTestPaymentAttempt(BigInt(order.id));

    const first = await markOrderPaid({
      orderId: BigInt(order.id),
      paymentAttemptId: paymentAttempt.id,
    });
    const second = await markOrderPaid({
      orderId: BigInt(order.id),
      paymentAttemptId: paymentAttempt.id,
    });

    expect(first.transitioned).toBe(true);
    expect(second.transitioned).toBe(false);
    expect(second.order.status).toBe("PAID");

    const saleMovements = await db.inventoryMovement.count({
      where: { orderItemId: BigInt(order.items[0]!.id), type: "SALE" },
    });
    expect(saleMovements).toBe(1);
  });

  it("a genuinely different, second SUCCESS payment attempt for an already-PAID order returns transitioned: false (double-payment race, sequential case)", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 8 });
    const order = await createTestOrder(admin, variantId, { quantity: 2 });
    const firstAttempt = await createTestPaymentAttempt(BigInt(order.id));
    const secondAttempt = await createTestPaymentAttempt(BigInt(order.id));

    const first = await markOrderPaid({
      orderId: BigInt(order.id),
      paymentAttemptId: firstAttempt.id,
    });
    expect(first.transitioned).toBe(true);

    const second = await markOrderPaid({
      orderId: BigInt(order.id),
      paymentAttemptId: secondAttempt.id,
    });
    expect(second.transitioned).toBe(false);
    expect(second.order.authoritativePaymentAttemptId).toBe(
      firstAttempt.id.toString(),
    );
  });

  it("markOrderPaid on a CANCELLED order returns transitioned: false — never resurrects the order to PAID", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(admin, variantId, { quantity: 1 });
    await cancelOrder(admin, BigInt(order.id), {});

    const paymentAttempt = await createTestPaymentAttempt(BigInt(order.id));
    const result = await markOrderPaid({
      orderId: BigInt(order.id),
      paymentAttemptId: paymentAttempt.id,
    });

    expect(result.transitioned).toBe(false);
    expect(result.order.status).toBe("CANCELLED");

    const saleMovements = await db.inventoryMovement.count({
      where: { orderItemId: BigInt(order.items[0]!.id), type: "SALE" },
    });
    expect(saleMovements).toBe(0);
  });
});
