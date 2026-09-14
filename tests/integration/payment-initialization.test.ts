import { afterAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import * as paymentRepo from "@/src/modules/payment/repo";
import { initializePayment } from "@/src/modules/payment/use-cases/initialize-payment";
import { retryPayment } from "@/src/modules/payment/use-cases/retry-payment";
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
import { createFakePaystackClient } from "./helpers/fake-paystack-client";

describe("payment: initialization + retry", () => {
  afterAll(async () => {
    await cleanupPaymentTestData();
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("INITIATED -> PENDING on a successful Paystack Initialize call", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const { order, payment } = await checkoutAndInitializePayment(
      customer,
      variantId,
    );
    expect(payment.outcome).toBe("PENDING");

    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });
    expect(attempt.status).toBe("PENDING");
    expect(attempt.authorizationUrl).not.toBeNull();
    expect(attempt.accessCode).not.toBeNull();
  });

  it("INITIATED -> INITIALIZATION_FAILED when Paystack rejects the Initialize call — order and reservation are untouched", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const failingClient = createFakePaystackClient({
      initializeTransaction: vi
        .fn()
        .mockRejectedValue(new Error("simulated Paystack outage")),
    });

    const { order, payment } = await checkoutAndInitializePayment(
      customer,
      variantId,
      {
        paystackClient: failingClient,
      },
    );
    expect(payment.outcome).toBe("INITIALIZATION_FAILED");

    const orderRow = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(orderRow.status).toBe("PENDING_PAYMENT");

    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });
    expect(attempt.status).toBe("INITIALIZATION_FAILED");
    expect(attempt.errorCode).toBeTruthy();
  });

  it("re-calling initializePayment on an already-PENDING attempt does not call Paystack again and returns the same authorization details", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const initializeSpy = vi.fn(
      createFakePaystackClient().initializeTransaction,
    );
    const client = createFakePaystackClient({
      initializeTransaction: initializeSpy,
    });

    const { order } = await checkoutAndInitializePayment(customer, variantId, {
      paystackClient: client,
    });
    expect(initializeSpy).toHaveBeenCalledTimes(1);

    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });

    const second = await initializePayment(attempt.id, customer.email, client);
    expect(initializeSpy).toHaveBeenCalledTimes(1); // still 1 — no second Paystack call
    expect(second.outcome).toBe("PENDING");
    if (second.outcome === "PENDING") {
      expect(second.authorizationUrl).toBe(attempt.authorizationUrl);
    }
  });

  it("initializePayment rejects an attempt in a terminal state", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const { order } = await checkoutAndInitializePayment(customer, variantId, {
      paystackClient: createFakePaystackClient({
        initializeTransaction: vi.fn().mockRejectedValue(new Error("fail")),
      }),
    });
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });
    expect(attempt.status).toBe("INITIALIZATION_FAILED");

    await expect(
      initializePayment(attempt.id, customer.email, createFakePaystackClient()),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("retryPayment creates a NEW attempt against the SAME order — never a new order, never a new reservation", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const { order } = await checkoutAndInitializePayment(customer, variantId, {
      paystackClient: createFakePaystackClient({
        initializeTransaction: vi.fn().mockRejectedValue(new Error("fail")),
      }),
    });

    const orderItemCountBefore = await db.orderItem.count({
      where: { orderId: BigInt(order.id) },
    });
    const reservationBefore = await db.inventoryMovement.count({
      where: {
        inventoryItem: { productVariantId: variantId },
        type: "RESERVE",
      },
    });

    const retryResult = await retryPayment(
      customer,
      BigInt(order.id),
      createFakePaystackClient(),
    );
    expect(retryResult.outcome).toBe("PENDING");

    const attempts = await paymentRepo.listAttemptsForOrder(BigInt(order.id));
    expect(attempts).toHaveLength(2);
    expect(attempts.map((a) => a.status).sort()).toEqual(
      ["INITIALIZATION_FAILED", "PENDING"].sort(),
    );

    const orderItemCountAfter = await db.orderItem.count({
      where: { orderId: BigInt(order.id) },
    });
    expect(orderItemCountAfter).toBe(orderItemCountBefore);

    const reservationAfter = await db.inventoryMovement.count({
      where: {
        inventoryItem: { productVariantId: variantId },
        type: "RESERVE",
      },
    });
    expect(reservationAfter).toBe(reservationBefore); // no re-reservation

    const orderCount = await db.order.count({
      where: { items: { some: { productVariantId: variantId } } },
    });
    expect(orderCount).toBe(1); // no second order
  });

  it("retryPayment rejects when the latest attempt is not terminal", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const { order } = await checkoutAndInitializePayment(customer, variantId); // PENDING

    await expect(
      retryPayment(customer, BigInt(order.id)),
    ).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("retryPayment rejects when the order is not PENDING_PAYMENT", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const { order } = await checkoutAndInitializePayment(customer, variantId, {
      paystackClient: createFakePaystackClient({
        initializeTransaction: vi.fn().mockRejectedValue(new Error("fail")),
      }),
    });

    const { cancelOrder } =
      await import("@/src/modules/order/use-cases/cancel-order");
    await cancelOrder(customer, BigInt(order.id), {});

    await expect(
      retryPayment(customer, BigInt(order.id)),
    ).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("retryPayment enforces ownership — User A cannot retry User B's order", async () => {
    const customerA = await createCustomerActor();
    const customerB = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const { order } = await checkoutAndInitializePayment(customerB, variantId, {
      paystackClient: createFakePaystackClient({
        initializeTransaction: vi.fn().mockRejectedValue(new Error("fail")),
      }),
    });

    await expect(
      retryPayment(customerA, BigInt(order.id)),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
