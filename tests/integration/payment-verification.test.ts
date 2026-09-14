import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";
import { cancelOrder } from "@/src/modules/order/use-cases/cancel-order";
import { verifyAndProcessPayment } from "@/src/modules/payment/use-cases/verify-and-process-payment";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createSuperAdminActor,
} from "./helpers/catalog-fixtures";
import { cleanupCartTestData } from "./helpers/cart-fixtures";
import {
  createFakePaystackClient,
  createSuccessVerifyingClient,
} from "./helpers/fake-paystack-client";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";
import {
  cleanupOrderTestData,
  createStockedProduct,
} from "./helpers/order-fixtures";
import {
  checkoutAndInitializePayment,
  cleanupPaymentTestData,
} from "./helpers/payment-fixtures";

describe("payment: verification (verify-then-act)", () => {
  afterAll(async () => {
    await cleanupPaymentTestData();
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("a verified success transitions the attempt to SUCCESS, the order to PAID, and converts RESERVE -> SALE", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 100_000,
    });

    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    const outcome = await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(100_000),
    );
    expect(outcome.outcome).toBe("SUCCESS");
    if (outcome.outcome === "SUCCESS") {
      expect(outcome.attemptTransitioned).toBe(true);
      expect(outcome.orderTransitioned).toBe(true);
    }

    const orderRow = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(orderRow.status).toBe("PAID");
    expect(orderRow.authoritativePaymentAttemptId?.toString()).toBe(
      attempt.id.toString(),
    );

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityReserved).toBe(0); // RESERVE -> SALE converted it away

    const saleMovements = await db.inventoryMovement.count({
      where: { inventoryItem: { productVariantId: variantId }, type: "SALE" },
    });
    expect(saleMovements).toBe(1);
  });

  it("a verified failure (Paystack status != success) transitions the attempt to FAILED, order untouched", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    const failingVerify = createFakePaystackClient({
      async verifyTransaction(reference) {
        return {
          id: 1,
          status: "failed",
          reference,
          amountMinor: attempt.amountMinor,
          currency: attempt.currency,
          gatewayResponse: "Declined",
          channel: "card",
          paidAt: null,
        };
      },
    });

    const outcome = await verifyAndProcessPayment(attempt.id, failingVerify);
    expect(outcome.outcome).toBe("FAILED");

    const attemptRow = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(attemptRow.status).toBe("FAILED");

    const orderRow = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(orderRow.status).toBe("PENDING_PAYMENT");
  });

  it("an amount mismatch never results in SUCCESS — the attempt is marked FAILED with AMOUNT_MISMATCH", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 100_000,
    });

    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    // Verified amount is deliberately wrong (half the real order amount).
    const outcome = await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(50_000),
    );
    expect(outcome.outcome).toBe("FAILED");
    if (outcome.outcome === "FAILED") {
      expect(outcome.errorCode).toBe("AMOUNT_MISMATCH");
    }

    const attemptRow = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(attemptRow.status).toBe("FAILED");
    expect(attemptRow.errorCode).toBe("AMOUNT_MISMATCH");

    const orderRow = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(orderRow.status).toBe("PENDING_PAYMENT");
  });

  it("a currency mismatch never results in SUCCESS", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 100_000,
    });

    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    const outcome = await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(100_000, "GHS"),
    );
    expect(outcome.outcome).toBe("FAILED");
    if (outcome.outcome === "FAILED") {
      expect(outcome.errorCode).toBe("CURRENCY_MISMATCH");
    }
  });

  it("a malformed/unavailable Verify response leaves the attempt PENDING, untouched, for the next retry", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    const flakyClient = createFakePaystackClient({
      async verifyTransaction() {
        throw new Error("simulated timeout");
      },
    });

    const outcome = await verifyAndProcessPayment(attempt.id, flakyClient);
    expect(outcome.outcome).toBe("VERIFICATION_INCONCLUSIVE");

    const attemptRow = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(attemptRow.status).toBe("PENDING"); // untouched
  });

  it("re-processing an already-resolved attempt is an idempotent no-op — never re-verified", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 50_000,
    });

    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(50_000),
    );

    const secondOutcome = await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(50_000),
    );
    expect(secondOutcome.outcome).toBe("ALREADY_RESOLVED");

    const saleMovements = await db.inventoryMovement.count({
      where: { inventoryItem: { productVariantId: variantId }, type: "SALE" },
    });
    expect(saleMovements).toBe(1); // never duplicated
  });

  it("LATE PAYMENT AFTER CANCELLATION: a verified success on a CANCELLED order never resurrects it, and is flagged for reconciliation", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 75_000,
    });

    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    await cancelOrder(customer, BigInt(order.id), {});
    const cancelledOrder = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(cancelledOrder.status).toBe("CANCELLED");

    const outcome = await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(75_000),
    );
    expect(outcome.outcome).toBe("SUCCESS");
    if (outcome.outcome === "SUCCESS") {
      expect(outcome.orderTransitioned).toBe(false); // never CANCELLED -> PAID
    }

    const orderAfter = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(orderAfter.status).toBe("CANCELLED"); // never resurrected
    expect(orderAfter.authoritativePaymentAttemptId).toBeNull();

    // The attempt is still a true, factual SUCCESS record.
    const attemptRow = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(attemptRow.status).toBe("SUCCESS");

    // Flagged for reconciliation — the same predicate covers this case
    // and the double-payment case (plan §11/§17/§23).
    const flags = await db.$queryRaw<{ id: bigint }[]>`
      SELECT pa.id FROM payment_attempts pa
      JOIN orders o ON o.id = pa.order_id
      WHERE pa.status = 'SUCCESS'
        AND (o.authoritative_payment_attempt_id IS NULL OR o.authoritative_payment_attempt_id <> pa.id)
        AND pa.id = ${attempt.id}
    `;
    expect(flags).toHaveLength(1);

    // Audit-logged.
    const auditEntry = await db.auditLog.findFirst({
      where: {
        action: "payment.succeeded_after_cancellation",
        entityId: BigInt(order.id),
      },
    });
    expect(auditEntry).not.toBeNull();

    // Inventory: order was cancelled first (which already released the
    // reservation) — verify no SALE was created despite the late success.
    const saleMovements = await db.inventoryMovement.count({
      where: { inventoryItem: { productVariantId: variantId }, type: "SALE" },
    });
    expect(saleMovements).toBe(0);
    const releaseMovements = await db.inventoryMovement.count({
      where: {
        inventoryItem: { productVariantId: variantId },
        type: "RELEASE",
      },
    });
    expect(releaseMovements).toBe(1);
  });
});
