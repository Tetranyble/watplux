import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { addCartItem } from "@/src/modules/cart/use-cases/add-cart-item";
import { completeCheckout } from "@/src/modules/checkout/use-cases/complete-checkout";
import { listPaymentAttemptsForGuestOrder } from "@/src/modules/payment/use-cases/list-payment-attempts-for-guest-order";
import { retryPaymentForGuestOrder } from "@/src/modules/payment/use-cases/retry-payment-for-guest-order";
import { isValidGuestOrderToken } from "@/src/modules/payment/use-cases/verify-guest-order-token";
import { generateGuestOrderToken } from "@/src/integrations/crypto/guest-order-token";
import { env } from "@/lib/env";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createSuperAdminActor,
} from "./helpers/catalog-fixtures";
import {
  createGuestOwner,
  cleanupCartTestData,
  ownerForUser,
} from "./helpers/cart-fixtures";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";
import {
  cleanupOrderTestData,
  createStockedProduct,
} from "./helpers/order-fixtures";
import {
  cleanupPaymentTestData,
  DEFAULT_SHIPPING_ADDRESS,
} from "./helpers/payment-fixtures";
import { createFakePaystackClient } from "./helpers/fake-paystack-client";

/**
 * docs/PHASE_9_STOREFRONT_PLAN.md §13.4 Option A — the guest-scoped
 * payment-result use-cases and the route-layer token verification they
 * depend on. `tests/unit/guest-order-token.test.ts` covers the underlying
 * crypto primitive in isolation; this file covers it wired against real
 * MySQL orders/payment attempts, plus the IDOR guarantees the approval
 * explicitly requires.
 */
describe("payment: guest order access token", () => {
  afterAll(async () => {
    await cleanupPaymentTestData();
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("completeCheckout issues a guestOrderAccessToken only for guest orders, never for authenticated ones", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const guest = createGuestOwner();
    await addCartItem(guest, { variantId, quantity: 1 });
    const guestResult = await completeCheckout(
      guest,
      {
        shippingAddress: DEFAULT_SHIPPING_ADDRESS,
        guestEmail: "guest-token-test@example.test",
      },
      undefined,
      createFakePaystackClient(),
    );
    expect(guestResult.guestOrderAccessToken).toBeDefined();
    expect(
      isValidGuestOrderToken(
        guestResult.guestOrderAccessToken!,
        BigInt(guestResult.order.id),
      ),
    ).toBe(true);

    const customer = await createCustomerActor();
    const { variantId: variantId2 } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const owner = ownerForUser(customer);
    await addCartItem(owner, { variantId: variantId2, quantity: 1 });
    const authedResult = await completeCheckout(
      owner,
      { shippingAddress: DEFAULT_SHIPPING_ADDRESS },
      customer.email,
      createFakePaystackClient(),
    );
    expect(authedResult.guestOrderAccessToken).toBeUndefined();
  });

  it("a guest can read their own order's payment attempts via listPaymentAttemptsForGuestOrder", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const guest = createGuestOwner();
    await addCartItem(guest, { variantId, quantity: 1 });
    const { order } = await completeCheckout(
      guest,
      {
        shippingAddress: DEFAULT_SHIPPING_ADDRESS,
        guestEmail: "guest-read@example.test",
      },
      undefined,
      createFakePaystackClient(),
    );

    const attempts = await listPaymentAttemptsForGuestOrder(BigInt(order.id));
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts[0]?.orderId).toBe(order.id);
  });

  it("the guest-scoped read is refused for an authenticated (non-guest) order — IDOR guard", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const owner = ownerForUser(customer);
    await addCartItem(owner, { variantId, quantity: 1 });
    const { order } = await completeCheckout(
      owner,
      { shippingAddress: DEFAULT_SHIPPING_ADDRESS },
      customer.email,
      createFakePaystackClient(),
    );

    await expect(
      listPaymentAttemptsForGuestOrder(BigInt(order.id)),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("a guest can retry payment for their own order via retryPaymentForGuestOrder", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const guest = createGuestOwner();
    await addCartItem(guest, { variantId, quantity: 1 });
    const { order } = await completeCheckout(
      guest,
      {
        shippingAddress: DEFAULT_SHIPPING_ADDRESS,
        guestEmail: "guest-retry@example.test",
      },
      undefined,
      createFakePaystackClient(),
    );

    const failingAttempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });
    await db.paymentAttempt.update({
      where: { id: failingAttempt.id },
      data: { status: "FAILED" },
    });

    const retryResult = await retryPaymentForGuestOrder(
      BigInt(order.id),
      createFakePaystackClient(),
    );
    expect(retryResult.outcome).toBe("PENDING");

    const attemptsAfter = await db.paymentAttempt.count({
      where: { orderId: BigInt(order.id) },
    });
    expect(attemptsAfter).toBe(2); // a NEW attempt, same order — never a new order
  });

  it("the guest-scoped retry is refused for an authenticated (non-guest) order — IDOR guard", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const owner = ownerForUser(customer);
    await addCartItem(owner, { variantId, quantity: 1 });
    const { order } = await completeCheckout(
      owner,
      { shippingAddress: DEFAULT_SHIPPING_ADDRESS },
      customer.email,
      createFakePaystackClient(),
    );

    await expect(
      retryPaymentForGuestOrder(BigInt(order.id)),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("isValidGuestOrderToken rejects a token scoped to a different order (IDOR via a stolen/reused token)", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const guestA = createGuestOwner();
    await addCartItem(guestA, { variantId, quantity: 1 });
    const { order: orderA, guestOrderAccessToken } = await completeCheckout(
      guestA,
      {
        shippingAddress: DEFAULT_SHIPPING_ADDRESS,
        guestEmail: "guest-a@example.test",
      },
      undefined,
      createFakePaystackClient(),
    );

    const { variantId: variantId2 } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const guestB = createGuestOwner();
    await addCartItem(guestB, { variantId: variantId2, quantity: 1 });
    const { order: orderB } = await completeCheckout(
      guestB,
      {
        shippingAddress: DEFAULT_SHIPPING_ADDRESS,
        guestEmail: "guest-b@example.test",
      },
      undefined,
      createFakePaystackClient(),
    );

    // Guest A's own token must never authorize reading/retrying Guest B's order.
    expect(
      isValidGuestOrderToken(guestOrderAccessToken!, BigInt(orderA.id)),
    ).toBe(true);
    expect(
      isValidGuestOrderToken(guestOrderAccessToken!, BigInt(orderB.id)),
    ).toBe(false);
  });

  it("isValidGuestOrderToken rejects an expired token", () => {
    if (!env.GUEST_ORDER_TOKEN_SECRET) {
      // No secret configured in this environment — generateGuestOrderToken
      // itself would return null, so there's nothing to expire; the
      // fail-closed behavior is already covered at the unit level
      // (tests/unit/guest-order-token.test.ts).
      return;
    }
    const expired = generateGuestOrderToken(
      BigInt(1),
      env.GUEST_ORDER_TOKEN_SECRET,
      -1, // already expired the instant it was issued
      new Date(),
    );
    expect(isValidGuestOrderToken(expired!, BigInt(1))).toBe(false);
  });

  it("isValidGuestOrderToken rejects a tampered token", () => {
    if (!env.GUEST_ORDER_TOKEN_SECRET) return;
    const token = generateGuestOrderToken(
      BigInt(1),
      env.GUEST_ORDER_TOKEN_SECRET,
      3600,
      new Date(),
    )!;
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(isValidGuestOrderToken(tampered, BigInt(1))).toBe(false);
  });
});
