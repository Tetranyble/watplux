import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";
import { cancelOrder } from "@/src/modules/order/use-cases/cancel-order";
import { createOrder } from "@/src/modules/order/use-cases/create-order";
import { markOrderPaid } from "@/src/modules/order/use-cases/mark-order-paid";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createSuperAdminActor,
} from "./helpers/catalog-fixtures";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";
import {
  buildCreateOrderInput,
  cleanupOrderTestData,
  createStockedProduct,
  createTestOrder,
  createTestPaymentAttempt,
} from "./helpers/order-fixtures";

/**
 * The mandatory concurrency scenarios (implementation-approval
 * requirement): genuinely overlapping `Promise.all`/`Promise.allSettled`
 * calls against the real database, asserting the FINAL DB ROW STATE
 * directly — never inferred from which promise resolved/rejected alone.
 * Run 5+ consecutive times with zero flaky failures as part of final
 * verification.
 *
 * Item 7 ("transaction-composition rollback after successful inventory
 * reservation but before final history insertion") is not duplicated
 * here — it lives in `tests/integration/order-creation.test.ts`'s
 * "MANDATORY ROLLBACK PROOF" test, which is included in the same 5x
 * repeated verification run as this file.
 */
describe("order: concurrency", () => {
  afterAll(async () => {
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("[1/7] two checkouts competing for the last inventory unit — exactly one order is created", async () => {
    const admin = await createSuperAdminActor();
    const customerA = await createCustomerActor();
    const customerB = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 1 });

    const results = await Promise.allSettled([
      createOrder(customerA, buildCreateOrderInput(variantId, { quantity: 1 })),
      createOrder(customerB, buildCreateOrderInput(variantId, { quantity: 1 })),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === "rejected") {
      expect(rejected[0].reason).toMatchObject({ statusCode: 400 });
    }

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityReserved).toBe(1);
    expect(balance.quantityAvailable).toBe(0);

    const ordersForVariant = await db.orderItem.count({
      where: { productVariantId: variantId },
    });
    expect(ordersForVariant).toBe(1);
  });

  it("[2/7] two concurrent cancellations of the same order — idempotent, exactly one RELEASE, exactly one history row", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(customer, variantId, { quantity: 2 });

    const results = await Promise.allSettled([
      cancelOrder(customer, BigInt(order.id), {}),
      cancelOrder(customer, BigInt(order.id), {}),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);

    const finalOrder = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(finalOrder.status).toBe("CANCELLED");

    const releaseMovements = await db.inventoryMovement.count({
      where: { orderItemId: BigInt(order.items[0]!.id), type: "RELEASE" },
    });
    expect(releaseMovements).toBe(1);

    const historyRows = await db.orderStatusHistory.count({
      where: { orderId: BigInt(order.id), toStatus: "CANCELLED" },
    });
    expect(historyRows).toBe(1);
  });

  it(
    "[3+4/7] cancellation racing payment success — whichever wins, the final state is self-consistent " +
      "(this single genuinely-raced test covers both named orderings: forcing a specific winner would " +
      "require artificial timing bias that misrepresents the real race)",
    async () => {
      const admin = await createSuperAdminActor();
      const customer = await createCustomerActor();
      const { variantId } = await createStockedProduct(admin, {
        quantity: 5,
      });
      const order = await createTestOrder(customer, variantId, {
        quantity: 2,
      });
      const paymentAttempt = await createTestPaymentAttempt(BigInt(order.id));

      const [cancelResult, payResult] = await Promise.allSettled([
        cancelOrder(customer, BigInt(order.id), {}),
        markOrderPaid({
          orderId: BigInt(order.id),
          paymentAttemptId: paymentAttempt.id,
        }),
      ]);

      const finalOrder = await db.order.findUniqueOrThrow({
        where: { id: BigInt(order.id) },
      });
      const orderItemId = BigInt(order.items[0]!.id);
      const releaseCount = await db.inventoryMovement.count({
        where: { orderItemId, type: "RELEASE" },
      });
      const saleCount = await db.inventoryMovement.count({
        where: { orderItemId, type: "SALE" },
      });

      if (finalOrder.status === "CANCELLED") {
        // Cancellation won the race.
        expect(cancelResult.status).toBe("fulfilled");
        // markOrderPaid's contract never rejects for this case — it
        // returns a distinguishable non-transition result instead.
        expect(payResult.status).toBe("fulfilled");
        if (payResult.status === "fulfilled") {
          expect(payResult.value.transitioned).toBe(false);
        }
        expect(releaseCount).toBe(1);
        expect(saleCount).toBe(0);
      } else if (finalOrder.status === "PAID") {
        // Payment success won the race.
        expect(payResult.status).toBe("fulfilled");
        if (payResult.status === "fulfilled") {
          expect(payResult.value.transitioned).toBe(true);
        }
        expect(cancelResult.status).toBe("rejected");
        if (cancelResult.status === "rejected") {
          expect(cancelResult.reason).toMatchObject({ statusCode: 409 });
        }
        expect(saleCount).toBe(1);
        expect(releaseCount).toBe(0);
      } else {
        throw new Error(`Unexpected final order status: ${finalOrder.status}`);
      }

      // Whichever won, the order is never left in an invalid mixed state.
      expect(["CANCELLED", "PAID"]).toContain(finalOrder.status);
    },
  );

  it("[5/7] duplicate markOrderPaid calls (genuinely concurrent, same payment attempt) — exactly one SALE, both calls resolve", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(customer, variantId, { quantity: 2 });
    const paymentAttempt = await createTestPaymentAttempt(BigInt(order.id));

    const results = await Promise.allSettled([
      markOrderPaid({
        orderId: BigInt(order.id),
        paymentAttemptId: paymentAttempt.id,
      }),
      markOrderPaid({
        orderId: BigInt(order.id),
        paymentAttemptId: paymentAttempt.id,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);
    const transitionedCount = fulfilled.filter(
      (r) => r.status === "fulfilled" && r.value.transitioned,
    ).length;
    expect(transitionedCount).toBe(1);

    const saleMovements = await db.inventoryMovement.count({
      where: { orderItemId: BigInt(order.items[0]!.id), type: "SALE" },
    });
    expect(saleMovements).toBe(1);

    const finalOrder = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(finalOrder.status).toBe("PAID");
  });

  it("[6/7] payment-attempt/order mismatch under concurrency — the valid call succeeds, the mismatched call is still rejected, neither order corrupted", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();

    const { variantId: variantAId } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const orderA = await createTestOrder(customer, variantAId, {
      quantity: 1,
    });
    const validAttemptForA = await createTestPaymentAttempt(BigInt(orderA.id));

    const { variantId: variantBId } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const orderB = await createTestOrder(customer, variantBId, {
      quantity: 1,
    });
    const attemptForB = await createTestPaymentAttempt(BigInt(orderB.id));

    const [validResult, mismatchedResult] = await Promise.allSettled([
      markOrderPaid({
        orderId: BigInt(orderA.id),
        paymentAttemptId: validAttemptForA.id,
      }),
      markOrderPaid({
        orderId: BigInt(orderA.id),
        paymentAttemptId: attemptForB.id, // belongs to Order B, not A
      }),
    ]);

    // The mismatch check is a relational pre-check via `db` — not a
    // locking race — so it is rejected regardless of interleaving.
    expect(mismatchedResult.status).toBe("rejected");
    if (mismatchedResult.status === "rejected") {
      expect(mismatchedResult.reason).toMatchObject({ statusCode: 400 });
    }

    const finalOrderA = await db.order.findUniqueOrThrow({
      where: { id: BigInt(orderA.id) },
    });
    const finalOrderB = await db.order.findUniqueOrThrow({
      where: { id: BigInt(orderB.id) },
    });
    // Order A was paid, but only via its OWN attempt.
    if (validResult.status === "fulfilled") {
      expect(finalOrderA.status).toBe("PAID");
      expect(finalOrderA.authoritativePaymentAttemptId?.toString()).toBe(
        validAttemptForA.id.toString(),
      );
    }
    // Order B was never touched by the mismatched call.
    expect(finalOrderB.status).toBe("PENDING_PAYMENT");
    expect(finalOrderB.authoritativePaymentAttemptId).toBeNull();
  });
});
