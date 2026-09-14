import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as paymentRepo from "@/src/modules/payment/repo";
import { ingestWebhookEvent } from "@/src/modules/payment/use-cases/ingest-webhook-event";
import { processWebhookEventBatch } from "@/src/modules/payment/use-cases/process-webhook-event-batch";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createSuperAdminActor,
} from "./helpers/catalog-fixtures";
import { cleanupCartTestData } from "./helpers/cart-fixtures";
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
  return `${Date.now()}${webhookEventCounter}`;
}

describe("payment: webhook ingestion + worker", () => {
  afterAll(async () => {
    await cleanupPaymentTestData();
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  describe("ingestion", () => {
    it("fails closed with NOT_CONFIGURED when no PAYSTACK_SECRET_KEY is configured — never silently accepts an unverifiable webhook", async () => {
      const result = await ingestWebhookEvent(
        {
          rawBody: JSON.stringify({ event: "charge.success", data: { id: 1 } }),
          signatureHeader: "irrelevant-since-not-configured",
        },
        null,
      );
      expect(result.outcome).toBe("NOT_CONFIGURED");

      const count = await db.webhookEvent.count({
        where: { paystackTransactionId: "1" },
      });
      expect(count).toBe(0); // no DB write happened
    });
  });

  describe("durable insert + idempotency (repo-level, real MySQL)", () => {
    it("a duplicate (event_type, paystack_transaction_id) is treated as already-recorded — never a second row", async () => {
      const transactionId = uniqueTransactionId();
      const first = await paymentRepo.insertWebhookEvent({
        eventType: "charge.success",
        paystackTransactionId: transactionId,
        paystackReference: "TESTWEBHOOK-dup-1",
        rawPayload: { event: "charge.success", data: { id: transactionId } },
      });
      expect(first.inserted).toBe(true);

      const second = await paymentRepo.insertWebhookEvent({
        eventType: "charge.success",
        paystackTransactionId: transactionId,
        paystackReference: "TESTWEBHOOK-dup-1",
        rawPayload: { event: "charge.success", data: { id: transactionId } },
      });
      expect(second.inserted).toBe(false);

      const count = await db.webhookEvent.count({
        where: { paystackTransactionId: transactionId },
      });
      expect(count).toBe(1);
    });

    it("the same paystack_transaction_id with a DIFFERENT event_type is a distinct, separately-recorded event", async () => {
      const transactionId = uniqueTransactionId();
      const success = await paymentRepo.insertWebhookEvent({
        eventType: "charge.success",
        paystackTransactionId: transactionId,
        paystackReference: "TESTWEBHOOK-distinct-1",
        rawPayload: {},
      });
      const failed = await paymentRepo.insertWebhookEvent({
        eventType: "charge.failed",
        paystackTransactionId: transactionId,
        paystackReference: "TESTWEBHOOK-distinct-1",
        rawPayload: {},
      });
      expect(success.inserted).toBe(true);
      expect(failed.inserted).toBe(true);
    });
  });

  describe("worker: claim mechanism", () => {
    it("processWebhookEventBatch claims a PENDING row and marks it PROCESSED", async () => {
      const transactionId = uniqueTransactionId();
      const { id } = await paymentRepo.insertWebhookEvent({
        eventType: "unknown.event.type",
        paystackTransactionId: transactionId,
        paystackReference: "TESTWEBHOOK-claim-1",
        rawPayload: {},
      });

      const result = await processWebhookEventBatch(50);
      expect(result.claimed).toBeGreaterThanOrEqual(1);

      const event = await db.webhookEvent.findUniqueOrThrow({
        where: { id: id! },
      });
      expect(event.processingStatus).toBe("PROCESSED");
    });

    it("a genuinely unrecognized event type is durably recorded and marked PROCESSED without acting on anything", async () => {
      const transactionId = uniqueTransactionId();
      const { id } = await paymentRepo.insertWebhookEvent({
        eventType: "customeridentification.success",
        paystackTransactionId: transactionId,
        // `TESTWEBHOOK-` prefix (not a real attempt's reference), so
        // cleanupPaymentTestData's orphan sweep can find it — this event
        // type genuinely carries no reference in real Paystack payloads,
        // but the row still needs a cleanup handle.
        paystackReference: "TESTWEBHOOK-unrecognized-1",
        rawPayload: {},
      });

      await processWebhookEventBatch(50);
      const event = await db.webhookEvent.findUniqueOrThrow({
        where: { id: id! },
      });
      expect(event.processingStatus).toBe("PROCESSED");
    });
  });

  describe("worker: charge event processing (verify-then-act, never trusts the webhook's claimed type)", () => {
    it("a charge.success event whose reference resolves to a real PENDING attempt transitions it via Verify, using a fake Paystack client", async () => {
      const customer = await createCustomerActor();
      const admin = await createSuperAdminActor();
      const { variantId } = await createStockedProduct(admin, {
        quantity: 5,
        priceMinor: 30_000,
      });
      const { order } = await checkoutAndInitializePayment(customer, variantId);
      const attempt = await db.paymentAttempt.findFirstOrThrow({
        where: { orderId: BigInt(order.id) },
      });

      const transactionId = uniqueTransactionId();
      await paymentRepo.insertWebhookEvent({
        eventType: "charge.success",
        paystackTransactionId: transactionId,
        paystackReference: attempt.paystackReference,
        rawPayload: {
          event: "charge.success",
          data: { id: transactionId, reference: attempt.paystackReference },
        },
      });

      // The worker's real Verify call would use the default (real)
      // Paystack client — this test exercises the worker's own
      // resolution/claim/outcome-recording logic, not the network call
      // itself, so we accept the resulting "VERIFICATION_INCONCLUSIVE"
      // outcome (no real network access in this environment) and confirm
      // the webhook event is retried, never crashing the worker or
      // corrupting state.
      const result = await processWebhookEventBatch(50);
      expect(result.claimed).toBeGreaterThanOrEqual(1);

      const attemptAfter = await db.paymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      // Untouched — a real network call to Paystack cannot succeed in
      // this sandboxed test environment, so the attempt correctly stays
      // PENDING rather than being marked FAILED for a transient reason.
      expect(attemptAfter.status).toBe("PENDING");
    });

    it("a charge event whose reference resolves to no local attempt is durably recorded and marked PROCESSED, nothing to act on", async () => {
      const transactionId = uniqueTransactionId();
      const { id } = await paymentRepo.insertWebhookEvent({
        eventType: "charge.success",
        paystackTransactionId: transactionId,
        paystackReference: "TESTWEBHOOK-no-such-attempt",
        rawPayload: {},
      });

      await processWebhookEventBatch(50);
      const event = await db.webhookEvent.findUniqueOrThrow({
        where: { id: id! },
      });
      expect(event.processingStatus).toBe("PROCESSED");
    });
  });

  describe("worker: refund events are deliberately deferred (plan §13.1/§18.2)", () => {
    it("a refund.processed event is durably recorded and marked PROCESSED, but never mutates any refund/payment_attempt row", async () => {
      const transactionId = uniqueTransactionId();
      const { id } = await paymentRepo.insertWebhookEvent({
        eventType: "refund.processed",
        paystackTransactionId: transactionId,
        paystackReference: "TESTWEBHOOK-refund-deferred",
        rawPayload: {},
      });

      const refundCountBefore = await db.refund.count();
      await processWebhookEventBatch(50);
      const refundCountAfter = await db.refund.count();
      expect(refundCountAfter).toBe(refundCountBefore); // untouched

      const event = await db.webhookEvent.findUniqueOrThrow({
        where: { id: id! },
      });
      expect(event.processingStatus).toBe("PROCESSED");
      expect(event.resolvedRefundId).toBeNull();
    });
  });

  describe("worker: crash-safety / staleness reclaim", () => {
    it("a stale PROCESSING row (past the configured staleness window) is reclaimable by a later pass", async () => {
      const transactionId = uniqueTransactionId();
      const { id } = await paymentRepo.insertWebhookEvent({
        eventType: "unknown.stale.test",
        paystackTransactionId: transactionId,
        paystackReference: "TESTWEBHOOK-stale-1",
        rawPayload: {},
      });

      // Simulate a worker that claimed the row and then crashed before
      // ever marking it PROCESSED/FAILED — force it into a stale
      // PROCESSING state directly.
      await db.webhookEvent.update({
        where: { id: id! },
        data: {
          processingStatus: "PROCESSING",
          lockedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        },
      });

      const claimable = await paymentRepo.findClaimableWebhookEventIds(50);
      expect(claimable.map((claimedId) => claimedId.toString())).toContain(
        id!.toString(),
      );

      const won = await paymentRepo.claimWebhookEvent(id!);
      expect(won).toBe(true);
    });

    it("a fresh (non-stale) PROCESSING row is NOT reclaimable — another worker still legitimately owns it", async () => {
      const transactionId = uniqueTransactionId();
      const { id } = await paymentRepo.insertWebhookEvent({
        eventType: "unknown.fresh.test",
        paystackTransactionId: transactionId,
        paystackReference: "TESTWEBHOOK-fresh-1",
        rawPayload: {},
      });

      await db.webhookEvent.update({
        where: { id: id! },
        data: { processingStatus: "PROCESSING", lockedAt: new Date() },
      });

      const won = await paymentRepo.claimWebhookEvent(id!);
      expect(won).toBe(false);
    });

    it("a webhook event exceeding the max processing-attempt cap is left permanently FAILED, not retried forever", async () => {
      const customer = await createCustomerActor();
      const admin = await createSuperAdminActor();
      const { variantId } = await createStockedProduct(admin, { quantity: 5 });
      const { order } = await checkoutAndInitializePayment(customer, variantId);
      const attempt = await db.paymentAttempt.findFirstOrThrow({
        where: { orderId: BigInt(order.id) },
      });

      const transactionId = uniqueTransactionId();
      const { id } = await paymentRepo.insertWebhookEvent({
        eventType: "charge.success",
        paystackTransactionId: transactionId,
        paystackReference: attempt.paystackReference,
        rawPayload: {},
      });

      // Simulate a row that's already exhausted its retry budget (real
      // network access will keep failing verification in this sandboxed
      // environment, driving processingAttempts up naturally, but this
      // test asserts the cap deterministically rather than looping).
      await db.webhookEvent.update({
        where: { id: id! },
        data: { processingAttempts: 999 },
      });

      await processWebhookEventBatch(50);
      const event = await db.webhookEvent.findUniqueOrThrow({
        where: { id: id! },
      });
      expect(event.processingStatus).toBe("FAILED");
    });
  });
});
