import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { cancelOrder } from "@/src/modules/order/use-cases/cancel-order";
import * as paymentRepo from "@/src/modules/payment/repo";
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

let webhookEventCounter = 0;
function uniqueTransactionId(): string {
  webhookEventCounter += 1;
  return `conc-${Date.now()}-${webhookEventCounter}-${Math.random().toString(36).slice(2)}`;
}

/**
 * All 10 mandatory concurrency scenarios
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §28.3): genuinely overlapping
 * `Promise.all`/`Promise.allSettled` calls against the real database,
 * asserting the FINAL DB ROW STATE directly — never inferred from which
 * promise resolved/rejected alone. Run 5+ consecutive times with zero
 * flaky failures as part of final verification.
 */
describe("payment: concurrency", () => {
  afterAll(async () => {
    await cleanupPaymentTestData();
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("[1/10] two identical success webhooks (same attempt) — exactly one SALE, exactly one PAID transition", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 80_000,
    });
    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    const results = await Promise.allSettled([
      verifyAndProcessPayment(attempt.id, createSuccessVerifyingClient(80_000)),
      verifyAndProcessPayment(attempt.id, createSuccessVerifyingClient(80_000)),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const orderRow = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(orderRow.status).toBe("PAID");

    const saleMovements = await db.inventoryMovement.count({
      where: { inventoryItem: { productVariantId: variantId }, type: "SALE" },
    });
    expect(saleMovements).toBe(1);

    const historyRows = await db.orderStatusHistory.count({
      where: { orderId: BigInt(order.id), toStatus: "PAID" },
    });
    expect(historyRows).toBe(1);
  });

  it("[2/10] two DIFFERENT attempts on the same order, both racing to succeed — exactly one authoritative, order PAID exactly once, never a double SALE", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 60_000,
    });
    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attemptA = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    // The normal retry flow structurally forbids a second PENDING attempt
    // while one already exists (plan §10) — by design, this scenario
    // cannot arise through the ordinary use-case surface. To test the
    // underlying DATABASE invariant itself (not merely the business rule
    // that happens to prevent triggering it), a second attempt is forced
    // into PENDING directly, simulating the only way this state could
    // ever arise (a data anomaly, not a normal flow) — exactly the kind
    // of defense-in-depth this plan requires (§11: "the database must
    // prevent both from becoming authoritative," not merely "the
    // application logic tries not to create the situation").
    const attemptB = await paymentRepo.createRetryAttempt({
      orderId: BigInt(order.id),
      amountMinor: 60_000,
      currency: "NGN",
    });
    await db.paymentAttempt.update({
      where: { id: attemptB.id },
      data: {
        status: "PENDING",
        authorizationUrl: "https://test",
        accessCode: "test",
      },
    });

    const results = await Promise.allSettled([
      verifyAndProcessPayment(
        attemptA.id,
        createSuccessVerifyingClient(60_000),
      ),
      verifyAndProcessPayment(
        attemptB.id,
        createSuccessVerifyingClient(60_000),
      ),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const orderRow = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(orderRow.status).toBe("PAID");

    const successfulAttempts = await db.paymentAttempt.findMany({
      where: { orderId: BigInt(order.id), status: "SUCCESS" },
    });
    expect(successfulAttempts).toHaveLength(2); // both are true, factual successes

    const authoritativeCount = successfulAttempts.filter(
      (a) => a.id === orderRow.authoritativePaymentAttemptId,
    ).length;
    expect(authoritativeCount).toBe(1); // exactly one claimed the pointer

    const saleMovements = await db.inventoryMovement.count({
      where: { inventoryItem: { productVariantId: variantId }, type: "SALE" },
    });
    expect(saleMovements).toBe(1); // never double-sold regardless of both succeeding
  });

  it("[3/10] success webhook races cancellation — whichever wins, the final state is self-consistent, never CANCELLED -> PAID", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 45_000,
    });
    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    const [payResult, cancelResult] = await Promise.allSettled([
      verifyAndProcessPayment(attempt.id, createSuccessVerifyingClient(45_000)),
      cancelOrder(customer, BigInt(order.id), {}),
    ]);

    const orderRow = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    const saleCount = await db.inventoryMovement.count({
      where: { inventoryItem: { productVariantId: variantId }, type: "SALE" },
    });
    const releaseCount = await db.inventoryMovement.count({
      where: {
        inventoryItem: { productVariantId: variantId },
        type: "RELEASE",
      },
    });

    if (orderRow.status === "PAID") {
      expect(payResult.status).toBe("fulfilled");
      expect(saleCount).toBe(1);
      expect(releaseCount).toBe(0);
    } else if (orderRow.status === "CANCELLED") {
      expect(cancelResult.status).toBe("fulfilled");
      expect(saleCount).toBe(0);
      expect(releaseCount).toBe(1);
      // The payment attempt itself may still be a true, factual SUCCESS
      // record — but never authoritative, never resurrecting the order.
      const attemptRow = await db.paymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      if (attemptRow.status === "SUCCESS") {
        expect(orderRow.authoritativePaymentAttemptId).toBeNull();
      }
    } else {
      throw new Error(`Unexpected final order status: ${orderRow.status}`);
    }
    expect(["PAID", "CANCELLED"]).toContain(orderRow.status);
  });

  it("[4/10] two workers race to claim the same webhook_events row — exactly one wins", async () => {
    const { id } = await paymentRepo.insertWebhookEvent({
      eventType: "unknown.claim.race",
      paystackTransactionId: uniqueTransactionId(),
      paystackReference: "TESTWEBHOOK-claim-race",
      rawPayload: {},
    });

    const results = await Promise.allSettled([
      paymentRepo.claimWebhookEvent(id!),
      paymentRepo.claimWebhookEvent(id!),
    ]);
    const wins = results.filter(
      (r) => r.status === "fulfilled" && r.value === true,
    );
    expect(wins).toHaveLength(1);

    const event = await db.webhookEvent.findUniqueOrThrow({
      where: { id: id! },
    });
    expect(event.processingAttempts).toBe(1); // only the winner incremented it
  });

  it("[5/10] two concurrent refund requests for the FULL amount — exactly one succeeds, never over-allocates", async () => {
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
    await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(100_000),
    );

    const results = await Promise.allSettled([
      requestRefund(admin, attempt.id, {}, createFakePaystackClient()),
      requestRefund(admin, attempt.id, {}, createFakePaystackClient()),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const attemptRow = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(attemptRow.pendingRefundAmountMinor).toBe(100_000); // never 200,000
  });

  it("[6/10] two concurrent confirmations of the same refund — exactly one ledger movement", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 40_000,
    });
    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });
    await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(40_000),
    );
    const refund = await requestRefund(
      admin,
      attempt.id,
      {},
      createFakePaystackClient(),
    );

    const results = await Promise.allSettled([
      paymentRepo.confirmRefund(BigInt(refund.id)),
      paymentRepo.confirmRefund(BigInt(refund.id)),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const transitionedCount = results.filter(
      (r) => r.status === "fulfilled" && r.value.transitioned,
    ).length;
    expect(transitionedCount).toBe(1);

    const attemptRow = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(attemptRow.refundedAmountMinor).toBe(40_000); // not 80,000
    expect(attemptRow.pendingRefundAmountMinor).toBe(0);
  });

  it("[7/10] two competing partial refunds whose sum exceeds the balance but each individually fits — exactly one succeeds", async () => {
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
    await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(100_000),
    );

    // 70,000 + 50,000 = 120,000 > 100,000 — exactly Phase 2B's own
    // originally-tested scenario, now genuinely concurrent.
    const results = await Promise.allSettled([
      requestRefund(
        admin,
        attempt.id,
        { amountMinor: 70_000 },
        createFakePaystackClient(),
      ),
      requestRefund(
        admin,
        attempt.id,
        { amountMinor: 50_000 },
        createFakePaystackClient(),
      ),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1);

    const attemptRow = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect([70_000, 50_000]).toContain(attemptRow.pendingRefundAmountMinor);
    expect(attemptRow.pendingRefundAmountMinor).toBeLessThanOrEqual(100_000);
  });

  it("[8/10] two concurrent ingestions of the identical (event_type, paystack_transaction_id) — exactly one row inserted, no thrown error", async () => {
    const transactionId = uniqueTransactionId();
    const insert = () =>
      paymentRepo.insertWebhookEvent({
        eventType: "charge.success",
        paystackTransactionId: transactionId,
        paystackReference: "TESTWEBHOOK-ingest-race",
        rawPayload: {},
      });

    const results = await Promise.allSettled([insert(), insert()]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const insertedCount = results.filter(
      (r) => r.status === "fulfilled" && r.value.inserted,
    ).length;
    expect(insertedCount).toBe(1);

    const rowCount = await db.webhookEvent.count({
      where: { paystackTransactionId: transactionId },
    });
    expect(rowCount).toBe(1);
  });

  it("[9/10] two concurrent worker batch runs over a shared pool of PENDING rows — no row processed twice", async () => {
    const ids: bigint[] = [];
    for (let i = 0; i < 6; i++) {
      const { id } = await paymentRepo.insertWebhookEvent({
        eventType: "unknown.batch.race",
        paystackTransactionId: uniqueTransactionId(),
        paystackReference: `TESTWEBHOOK-batch-race-${i}`,
        rawPayload: {},
      });
      ids.push(id!);
    }

    const { processWebhookEventBatch } =
      await import("@/src/modules/payment/use-cases/process-webhook-event-batch");
    // Batch size covers more than this test's own 6 rows, so earlier
    // tests' leftover PENDING rows in the same table may legitimately
    // also be swept up by these two calls — the invariant under test is
    // "none of THESE 6 rows was ever claimed by both calls," not "the
    // two calls claimed exactly 6 system-wide."
    const [resultA, resultB] = await Promise.all([
      processWebhookEventBatch(10),
      processWebhookEventBatch(10),
    ]);
    expect(resultA.claimed + resultB.claimed).toBeGreaterThanOrEqual(6);

    const events = await db.webhookEvent.findMany({
      where: { id: { in: ids } },
    });
    expect(events.every((e) => e.processingStatus === "PROCESSED")).toBe(true);
    expect(events.every((e) => e.processingAttempts === 1)).toBe(true); // never claimed twice
  });

  it("[10/10] sequential retry after a successful commit — idempotent, no second SALE, no second order transition", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 33_000,
    });
    const { order } = await checkoutAndInitializePayment(customer, variantId);
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    const first = await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(33_000),
    );
    expect(first.outcome).toBe("SUCCESS");

    const second = await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(33_000),
    );
    expect(second.outcome).toBe("ALREADY_RESOLVED");

    const saleMovements = await db.inventoryMovement.count({
      where: { inventoryItem: { productVariantId: variantId }, type: "SALE" },
    });
    expect(saleMovements).toBe(1);

    const historyRows = await db.orderStatusHistory.count({
      where: { orderId: BigInt(order.id), toStatus: "PAID" },
    });
    expect(historyRows).toBe(1);
  });
});
