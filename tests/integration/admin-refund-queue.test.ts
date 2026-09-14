import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { cancelRefund } from "@/src/modules/payment/use-cases/cancel-refund";
import { listRefundsForAdmin } from "@/src/modules/payment/use-cases/list-refunds-for-admin";
import { requestRefund } from "@/src/modules/payment/use-cases/request-refund";
import { verifyAndProcessPayment } from "@/src/modules/payment/use-cases/verify-and-process-payment";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createStaffActor,
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

/**
 * docs/PHASE_10_ADMIN_PLAN.md §14/§28.6/§31 — the small additive
 * admin-wide refund queue read (`listRefundsForAdmin`). No prior test
 * exercised this: `refund-lifecycle.test.ts` only ever reads a refund
 * back via `db` directly or the per-attempt `RefundRecord[]`, never this
 * new cross-order cursor query.
 */
async function createRefundedAttempt(
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
  const refund = await requestRefund(
    admin,
    attempt.id,
    {},
    createFakePaystackClient(),
  );
  return { attemptId: attempt.id, refund };
}

describe("admin: refund queue (listRefundsForAdmin)", () => {
  afterAll(async () => {
    await cleanupPaymentTestData();
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("super_admin and staff (both hold payments.read) can list refunds", async () => {
    const admin = await createSuperAdminActor();
    const staff = await createStaffActor();
    await expect(
      listRefundsForAdmin(admin, { limit: 20 }),
    ).resolves.toBeDefined();
    await expect(
      listRefundsForAdmin(staff, { limit: 20 }),
    ).resolves.toBeDefined();
  });

  it("a customer (no payments.read) is rejected", async () => {
    const customer = await createCustomerActor();
    await expect(
      listRefundsForAdmin(customer, { limit: 20 }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("reflects a freshly-created refund, newest-requested-first", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const { refund } = await createRefundedAttempt(customer, admin, 50_000);

    const page = await listRefundsForAdmin(admin, { limit: 50 });
    expect(page.items[0]!.id).toBe(refund.id);
    expect(page.items.some((r) => r.id === refund.id)).toBe(true);
  });

  it("filters by status", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const { refund } = await createRefundedAttempt(customer, admin, 60_000);
    expect(refund.status).toBe("REFUND_PENDING");

    const pending = await listRefundsForAdmin(admin, {
      limit: 50,
      status: "REFUND_PENDING",
    });
    expect(pending.items.some((r) => r.id === refund.id)).toBe(true);

    const cancelled = await listRefundsForAdmin(admin, {
      limit: 50,
      status: "REFUND_CANCELLED",
    });
    expect(cancelled.items.some((r) => r.id === refund.id)).toBe(false);
  });

  it("reflects a cancelled refund's updated status", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const { refund } = await createRefundedAttempt(customer, admin, 70_000);

    await cancelRefund(admin, BigInt(refund.id));

    const page = await listRefundsForAdmin(admin, {
      limit: 50,
      status: "REFUND_CANCELLED",
    });
    expect(page.items.some((r) => r.id === refund.id)).toBe(true);
  });

  it("paginates via cursor without skipping or duplicating rows", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const first = await createRefundedAttempt(customer, admin, 10_000);
    const second = await createRefundedAttempt(customer, admin, 10_000);

    const firstPage = await listRefundsForAdmin(admin, { limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]!.id).toBe(second.refund.id);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listRefundsForAdmin(admin, {
      limit: 1,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]!.id).toBe(first.refund.id);
  });
});
