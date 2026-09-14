import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";
import { cancelOrder } from "@/src/modules/order/use-cases/cancel-order";
import { markOrderPaid } from "@/src/modules/order/use-cases/mark-order-paid";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createStaffActor,
  createSuperAdminActor,
} from "./helpers/catalog-fixtures";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";
import {
  cleanupOrderTestData,
  createStockedProduct,
  createTestOrder,
  createTestPaymentAttempt,
} from "./helpers/order-fixtures";

describe("order: cancellation", () => {
  afterAll(async () => {
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("customer cancels their own PENDING_PAYMENT order — status transitions, reservation released, exactly one history row", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 10 });
    const order = await createTestOrder(admin, variantId, { quantity: 4 });

    const cancelled = await cancelOrder(admin, BigInt(order.id), {});
    expect(cancelled.status).toBe("CANCELLED");

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(10);
    expect(balance.quantityReserved).toBe(0);
    expect(balance.quantityAvailable).toBe(10);

    const releaseMovements = await db.inventoryMovement.findMany({
      where: {
        orderItemId: BigInt(order.items[0]!.id),
        type: "RELEASE",
      },
    });
    expect(releaseMovements).toHaveLength(1);

    const historyRows = await db.orderStatusHistory.findMany({
      where: { orderId: BigInt(order.id) },
      orderBy: { id: "asc" },
    });
    expect(historyRows.map((h) => h.toStatus)).toEqual([
      "PENDING_PAYMENT",
      "CANCELLED",
    ]);
    expect(historyRows[1]!.actorType).toBe("SYSTEM");
    expect(historyRows[1]!.actorId?.toString()).toBe(admin.id.toString());
  });

  it("staff (orders.update) can cancel another customer's order — actorType is ADMIN, not SYSTEM", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const staff = await createStaffActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 10 });
    const order = await createTestOrder(customer, variantId, { quantity: 1 });

    const cancelled = await cancelOrder(staff, BigInt(order.id), {
      note: "Customer requested via support",
    });
    expect(cancelled.status).toBe("CANCELLED");

    const historyRow = await db.orderStatusHistory.findFirst({
      where: { orderId: BigInt(order.id), toStatus: "CANCELLED" },
    });
    expect(historyRow!.actorType).toBe("ADMIN");
    expect(historyRow!.actorId?.toString()).toBe(staff.id.toString());
    expect(historyRow!.note).toBe("Customer requested via support");
  });

  it("a customer without ownership and without orders.update cannot cancel another customer's order", async () => {
    const admin = await createSuperAdminActor();
    const ownerCustomer = await createCustomerActor();
    const otherCustomer = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(ownerCustomer, variantId);

    await expect(
      cancelOrder(otherCustomer, BigInt(order.id), {}),
    ).rejects.toMatchObject({ statusCode: 403 });

    const stillPending = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(stillPending.status).toBe("PENDING_PAYMENT");
  });

  it("cancelling a nonexistent order returns 404", async () => {
    const admin = await createSuperAdminActor();
    await expect(
      cancelOrder(admin, BigInt("999999999999"), {}),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("cancelling an already-CANCELLED order is idempotent — no error, no double release", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 6 });
    const order = await createTestOrder(admin, variantId, { quantity: 2 });

    const first = await cancelOrder(admin, BigInt(order.id), {});
    const second = await cancelOrder(admin, BigInt(order.id), {});
    expect(first.status).toBe("CANCELLED");
    expect(second.status).toBe("CANCELLED");

    const releaseMovements = await db.inventoryMovement.findMany({
      where: { orderItemId: BigInt(order.items[0]!.id), type: "RELEASE" },
    });
    expect(releaseMovements).toHaveLength(1);

    const historyRows = await db.orderStatusHistory.count({
      where: { orderId: BigInt(order.id), toStatus: "CANCELLED" },
    });
    expect(historyRows).toBe(1);
  });

  it("cancelling a PAID order is rejected with a genuine conflict, not treated as idempotent", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 3 });
    const order = await createTestOrder(admin, variantId, { quantity: 1 });
    const paymentAttempt = await createTestPaymentAttempt(BigInt(order.id));
    const { transitioned } = await markOrderPaid({
      orderId: BigInt(order.id),
      paymentAttemptId: paymentAttempt.id,
    });
    expect(transitioned).toBe(true);

    await expect(
      cancelOrder(admin, BigInt(order.id), {}),
    ).rejects.toMatchObject({ statusCode: 409 });

    const stillPaid = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(stillPaid.status).toBe("PAID");
  });
});
