import { afterAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import * as paymentRepo from "@/src/modules/payment/repo";
import { cancelRefund } from "@/src/modules/payment/use-cases/cancel-refund";
import { requestRefund } from "@/src/modules/payment/use-cases/request-refund";
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

async function createSuccessfulAttempt(
  customer: Awaited<ReturnType<typeof createCustomerActor>>,
  admin: Awaited<ReturnType<typeof createSuperAdminActor>>,
  priceMinor: number,
) {
  const { variantId } = await createStockedProduct(admin, {
    quantity: 5,
    priceMinor,
  });
  const { order } = await checkoutAndInitializePayment(customer, variantId);
  const attempt = await db.paymentAttempt.findFirstOrThrow({
    where: { orderId: BigInt(order.id) },
  });
  await verifyAndProcessPayment(
    attempt.id,
    createSuccessVerifyingClient(priceMinor),
  );
  return { order, attemptId: attempt.id };
}

describe("payment: refund lifecycle", () => {
  afterAll(async () => {
    await cleanupPaymentTestData();
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("a full refund request allocates, calls Paystack, and moves to REFUND_PENDING", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { attemptId } = await createSuccessfulAttempt(
      customer,
      admin,
      100_000,
    );

    const refund = await requestRefund(
      admin,
      attemptId,
      {},
      createFakePaystackClient(),
    );
    expect(refund.status).toBe("REFUND_PENDING");
    expect(refund.amountMinor).toBe(100_000);

    const attempt = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(attempt.pendingRefundAmountMinor).toBe(100_000);
    expect(attempt.refundedAmountMinor).toBe(0);
  });

  it("requestRefund rejects a non-SUCCESS attempt", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    await expect(
      requestRefund(admin, attempt.id, {}, createFakePaystackClient()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("over-allocation is rejected — never allocates more than the paid amount (plan §20)", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { attemptId } = await createSuccessfulAttempt(
      customer,
      admin,
      100_000,
    );

    await expect(
      requestRefund(
        admin,
        attemptId,
        { amountMinor: 150_000 },
        createFakePaystackClient(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    const attempt = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(attempt.pendingRefundAmountMinor).toBe(0);
  });

  it("two sequential partial refunds within budget both succeed; a third exceeding the remainder is rejected", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { attemptId } = await createSuccessfulAttempt(
      customer,
      admin,
      100_000,
    );

    const refundA = await requestRefund(
      admin,
      attemptId,
      { amountMinor: 60_000 },
      createFakePaystackClient(),
    );
    expect(refundA.status).toBe("REFUND_PENDING");

    const refundB = await requestRefund(
      admin,
      attemptId,
      { amountMinor: 30_000 },
      createFakePaystackClient(),
    );
    expect(refundB.status).toBe("REFUND_PENDING");

    // 60,000 + 30,000 + 20,000 = 110,000 > 100,000 — must be refused.
    await expect(
      requestRefund(
        admin,
        attemptId,
        { amountMinor: 20_000 },
        createFakePaystackClient(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    const attempt = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(attempt.pendingRefundAmountMinor).toBe(90_000);
  });

  it("confirmRefund moves pending -> confirmed and marks the order REFUNDED when the full amount is confirmed", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { order, attemptId } = await createSuccessfulAttempt(
      customer,
      admin,
      50_000,
    );

    const refund = await requestRefund(
      admin,
      attemptId,
      {},
      createFakePaystackClient(),
    );

    const { transitioned } = await paymentRepo.confirmRefund(BigInt(refund.id));
    expect(transitioned).toBe(true);

    const attempt = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(attempt.pendingRefundAmountMinor).toBe(0);
    expect(attempt.refundedAmountMinor).toBe(50_000);

    const refundRow = await db.refund.findUniqueOrThrow({
      where: { id: BigInt(refund.id) },
    });
    expect(refundRow.status).toBe("REFUNDED");

    const orderRow = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(orderRow.status).toBe("REFUNDED");
  });

  it("confirmRefund is idempotent — confirming twice never double-applies the ledger movement", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { attemptId } = await createSuccessfulAttempt(
      customer,
      admin,
      40_000,
    );
    const refund = await requestRefund(
      admin,
      attemptId,
      {},
      createFakePaystackClient(),
    );

    const first = await paymentRepo.confirmRefund(BigInt(refund.id));
    expect(first.transitioned).toBe(true);
    const second = await paymentRepo.confirmRefund(BigInt(refund.id));
    expect(second.transitioned).toBe(false);

    const attempt = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(attempt.refundedAmountMinor).toBe(40_000); // not 80,000
  });

  it("a partial refund confirmation does not move the order out of PAID", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { order, attemptId } = await createSuccessfulAttempt(
      customer,
      admin,
      100_000,
    );
    const refund = await requestRefund(
      admin,
      attemptId,
      { amountMinor: 30_000 },
      createFakePaystackClient(),
    );

    await paymentRepo.confirmRefund(BigInt(refund.id));

    const orderRow = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(orderRow.status).toBe("PAID");
  });

  it("an admin can cancel a pending refund request, releasing the allocation", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { attemptId } = await createSuccessfulAttempt(
      customer,
      admin,
      60_000,
    );
    const refund = await requestRefund(
      admin,
      attemptId,
      {},
      createFakePaystackClient(),
    );

    const cancelled = await cancelRefund(admin, BigInt(refund.id));
    expect(cancelled.status).toBe("REFUND_CANCELLED");

    const attempt = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(attempt.pendingRefundAmountMinor).toBe(0);
  });

  it("a refund is never marked REFUNDED merely because Paystack's Create Refund API accepted the request", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { attemptId } = await createSuccessfulAttempt(
      customer,
      admin,
      60_000,
    );

    const refund = await requestRefund(
      admin,
      attemptId,
      {},
      createFakePaystackClient(),
    );
    // Acceptance only moves REQUESTED -> PENDING, never straight to REFUNDED.
    expect(refund.status).toBe("REFUND_PENDING");
    expect(refund.status).not.toBe("REFUNDED");
  });

  it("if the Create Refund API call itself fails, the allocation is released immediately (REFUND_FAILED)", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { attemptId } = await createSuccessfulAttempt(
      customer,
      admin,
      60_000,
    );

    const failingClient = createFakePaystackClient({
      createRefund: vi
        .fn()
        .mockRejectedValue(new Error("Paystack refund API down")),
    });

    await expect(
      requestRefund(admin, attemptId, {}, failingClient),
    ).rejects.toMatchObject({ statusCode: 400 });

    const attempt = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(attempt.pendingRefundAmountMinor).toBe(0); // released, not stuck

    const refundRow = await db.refund.findFirstOrThrow({
      where: { paymentAttemptId: attemptId },
    });
    expect(refundRow.status).toBe("REFUND_FAILED");
  });
});
