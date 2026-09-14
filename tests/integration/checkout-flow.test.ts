import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { archiveVariant } from "@/src/modules/catalog/use-cases/archive-variant";
import { createVariant } from "@/src/modules/catalog/use-cases/create-variant";
import { updateVariant } from "@/src/modules/catalog/use-cases/update-variant";
import { addCartItem } from "@/src/modules/cart/use-cases/add-cart-item";
import { getActiveCart } from "@/src/modules/cart/use-cases/get-active-cart";
import * as checkoutRepo from "@/src/modules/checkout/repo";
import { completeCheckout } from "@/src/modules/checkout/use-cases/complete-checkout";
import { validateCheckout } from "@/src/modules/checkout/use-cases/validate-checkout";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createSuperAdminActor,
} from "./helpers/catalog-fixtures";
import {
  cleanupCartTestData,
  createGuestOwner,
  ownerForUser,
} from "./helpers/cart-fixtures";
import { createFakePaystackClient } from "./helpers/fake-paystack-client";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";
import {
  cleanupOrderTestData,
  createStockedProduct,
} from "./helpers/order-fixtures";

const shippingAddress = {
  fullName: "Checkout Test Customer",
  phone: "+2348012345678",
  addressLine1: "1 Checkout Street",
  city: "Lagos",
  state: "Lagos",
  country: "NG",
};

describe("checkout: validation + completion", () => {
  afterAll(async () => {
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("validateCheckout throws NotFoundError when the caller has no cart at all", async () => {
    const owner = createGuestOwner();
    await expect(validateCheckout(owner)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("validateCheckout reports a valid, non-empty cart correctly", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const owner = ownerForUser(customer);
    await addCartItem(owner, { variantId, quantity: 2 });

    const report = await validateCheckout(owner);
    expect(report.isValid).toBe(true);
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]!.isValid).toBe(true);
    expect(report.lines[0]!.hasSufficientStock).toBe(true);
  });

  it("validateCheckout flags an archived variant as invalid, without mutating the cart", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { product, variantId } = await createStockedProduct(admin, {
      quantity: 5,
    });
    await createVariant(admin, {
      productId: BigInt(product.id),
      sku: `PHASE4TEST-SKU-EXTRA-${Date.now()}`,
      priceMinor: 1_000,
    });
    const owner = ownerForUser(customer);
    await addCartItem(owner, { variantId, quantity: 1 });
    await archiveVariant(admin, variantId);

    const report = await validateCheckout(owner);
    expect(report.isValid).toBe(false);
    expect(report.lines[0]!.isVariantActive).toBe(false);
    expect(report.lines[0]!.issue).toContain("no longer available");

    const cartAfter = await getActiveCart(owner);
    expect(cartAfter?.items).toHaveLength(1);
  });

  it("validateCheckout flags insufficient stock, non-authoritatively", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 1 });
    const owner = ownerForUser(customer);
    await addCartItem(owner, { variantId, quantity: 5 });

    const report = await validateCheckout(owner);
    expect(report.isValid).toBe(false);
    expect(report.lines[0]!.hasSufficientStock).toBe(false);
    expect(report.lines[0]!.issue).toContain("Insufficient stock");
  });

  it("completeCheckout: full happy path — order created, inventory reserved, cart CONVERTED, payment attempt INITIATED", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 10,
      priceMinor: 75_000,
    });
    const owner = ownerForUser(customer);
    const cartBefore = await addCartItem(owner, { variantId, quantity: 3 });

    const { order, payment } = await completeCheckout(
      owner,
      { shippingAddress },
      customer.email,
      createFakePaystackClient(),
    );

    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.items).toHaveLength(1);
    expect(order.items[0]!.quantity).toBe(3);
    expect(order.totalMinor).toBe(225_000);
    // Phase 8: checkout now also initializes the payment attempt with
    // Paystack (a fake client here, plan §28.4) — the payment attempt no
    // longer stays INITIATED after a successful checkout.
    expect(payment.outcome).toBe("PENDING");

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityReserved).toBe(3);
    expect(balance.quantityAvailable).toBe(7);

    const cartRow = await db.cart.findUnique({
      where: { id: BigInt(cartBefore.id) },
    });
    expect(cartRow?.status).toBe("CONVERTED");

    const paymentAttempt = await db.paymentAttempt.findFirst({
      where: { orderId: BigInt(order.id) },
    });
    expect(paymentAttempt?.status).toBe("PENDING");
    expect(paymentAttempt?.amountMinor).toBe(225_000);
    expect(paymentAttempt?.authorizationUrl).not.toBeNull();
    expect(paymentAttempt?.accessCode).not.toBeNull();

    // Cart conversion is atomic with successful checkout — no active cart
    // remains for this identity.
    expect(await getActiveCart(owner)).toBeNull();
  });

  it("completeCheckout uses the CURRENT catalog price, never the cart's stale stored snapshot", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 10_000,
    });
    const owner = ownerForUser(customer);
    const cart = await addCartItem(owner, { variantId, quantity: 1 });
    expect(cart.items[0]!.priceSnapshotMinor).toBe(10_000);

    await updateVariant(admin, variantId, { priceMinor: 40_000 });

    const { order } = await completeCheckout(
      owner,
      { shippingAddress },
      customer.email,
      createFakePaystackClient(),
    );
    expect(order.items[0]!.unitPriceMinor).toBe(40_000);
    expect(order.totalMinor).toBe(40_000);
  });

  it("completeCheckout throws NotFoundError with no cart at all", async () => {
    const owner = createGuestOwner();
    await expect(
      completeCheckout(owner, { shippingAddress }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("completeCheckout rejects an empty cart without creating anything", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const owner = ownerForUser(customer);
    const cart = await addCartItem(owner, { variantId, quantity: 1 });
    const { removeCartItem } =
      await import("@/src/modules/cart/use-cases/remove-cart-item");
    await removeCartItem(owner, BigInt(cart.items[0]!.id));

    await expect(
      completeCheckout(owner, { shippingAddress }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const cartRow = await db.cart.findUnique({
      where: { id: BigInt(cart.id) },
    });
    expect(cartRow?.status).toBe("ACTIVE");
  });

  it("guest checkout requires a contact email address", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const guest = createGuestOwner();
    await addCartItem(guest, { variantId, quantity: 1 });

    await expect(
      completeCheckout(guest, { shippingAddress }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("guest checkout with a contact email succeeds", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const guest = createGuestOwner();
    await addCartItem(guest, { variantId, quantity: 1 });

    const { order } = await completeCheckout(
      guest,
      { shippingAddress, guestEmail: "guest-checkout@example.test" },
      undefined,
      createFakePaystackClient(),
    );
    expect(order.guestEmail).toBe("guest-checkout@example.test");
    expect(order.userId).toBeNull();
  });

  it("an archived variant at checkout time is rejected — entire checkout fails, cart itself unmodified, no partial order", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { product, variantId } = await createStockedProduct(admin, {
      quantity: 5,
    });
    await createVariant(admin, {
      productId: BigInt(product.id),
      sku: `PHASE4TEST-SKU-EXTRA-${Date.now()}`,
      priceMinor: 1_000,
    });
    const owner = ownerForUser(customer);
    const cart = await addCartItem(owner, { variantId, quantity: 1 });
    await archiveVariant(admin, variantId);

    const orderCountBefore = await db.order.count();
    await expect(
      completeCheckout(owner, { shippingAddress }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await db.order.count()).toBe(orderCountBefore);

    const cartRow = await db.cart.findUnique({
      where: { id: BigInt(cart.id) },
    });
    expect(cartRow?.status).toBe("ACTIVE");
    const remainingItems = await db.cartItem.count({
      where: { cartId: BigInt(cart.id) },
    });
    expect(remainingItems).toBe(1);
  });

  it("insufficient inventory at checkout time is rejected — cart unmodified, no partial order, no reservation", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 2 });
    const owner = ownerForUser(customer);
    const cart = await addCartItem(owner, { variantId, quantity: 10 });

    await expect(
      completeCheckout(owner, { shippingAddress }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityReserved).toBe(0);
    expect(balance.quantityAvailable).toBe(2);

    const cartRow = await db.cart.findUnique({
      where: { id: BigInt(cart.id) },
    });
    expect(cartRow?.status).toBe("ACTIVE");
  });

  it("MANDATORY ROLLBACK PROOF: a failure after inventory reservation but before cart conversion rolls back everything, cart remains ACTIVE", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 10 });
    const owner = ownerForUser(customer);
    const cart = await addCartItem(owner, { variantId, quantity: 2 });

    // A genuinely nonexistent user id — `order_status_history` (inserted
    // strictly AFTER inventory reservation, INSIDE `createOrderInTransaction`,
    // which itself runs BEFORE the cart's own status transition in
    // `checkoutRepo.completeCheckout`, plan §16) has a real FK to
    // `users.id`; this forces MySQL to reject exactly that statement,
    // deliberately injected to run after reservation has already applied
    // within the (still-uncommitted) transaction — the same technique
    // `tests/integration/order-creation.test.ts`'s own rollback-proof
    // test established.
    const nonexistentActorId = BigInt("999999999999");

    await expect(
      checkoutRepo.completeCheckout({
        cartId: BigInt(cart.id),
        owner,
        userId: customer.id,
        guestEmail: null,
        guestPhone: null,
        customerNote: null,
        shippingAddress: {
          type: "SHIPPING",
          ...shippingAddress,
          addressLine2: null,
          postalCode: null,
          deliveryNotes: null,
        },
        billingAddress: null,
        initialActorId: nonexistentActorId,
      }),
    ).rejects.toThrow();

    // Direct, fresh database re-reads — never inferred from the
    // rejection alone.
    const orderCount = await db.order.count({
      where: { items: { some: { productVariantId: variantId } } },
    });
    expect(orderCount).toBe(0);

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(10);
    expect(balance.quantityReserved).toBe(0);
    expect(balance.quantityAvailable).toBe(10);

    // Only the RESTOCK from setup — the RESERVE this test attempted was
    // fully rolled back along with everything else (mirrors
    // `tests/integration/order-creation.test.ts`'s identical assertion).
    const movements = await db.inventoryMovement.findMany({
      where: { inventoryItem: { productVariantId: variantId } },
    });
    expect(movements.map((m) => m.type)).toEqual(["RESTOCK"]);

    const cartRow = await db.cart.findUnique({
      where: { id: BigInt(cart.id) },
    });
    expect(cartRow?.status).toBe("ACTIVE");
    const remainingItems = await db.cartItem.count({
      where: { cartId: BigInt(cart.id) },
    });
    expect(remainingItems).toBe(1);
  });

  it("the initial payment-attempt reference is Paystack-safe (alphanumeric + '-' only, plan §8.3) — never base64url's '_'", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const owner = ownerForUser(customer);
    await addCartItem(owner, { variantId, quantity: 1 });

    const { order } = await completeCheckout(owner, { shippingAddress });
    const paymentAttempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });
    // No Paystack client was injected here — with no PAYSTACK_SECRET_KEY
    // configured in the test environment, initialization fails cleanly
    // (plan §8's INITIALIZATION_FAILED path) rather than throwing or
    // corrupting the already-committed order.
    expect(paymentAttempt.status).toBe("INITIALIZATION_FAILED");
    expect(paymentAttempt.paystackReference).toMatch(/^CHKOUT-[0-9a-f]+$/);
  });

  it("checkout's own database transaction never makes an external call — Paystack initialization happens strictly after commit, and its outcome never affects the committed order/cart/inventory state", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const owner = ownerForUser(customer);
    const cart = await addCartItem(owner, { variantId, quantity: 1 });

    const { order, payment } = await completeCheckout(
      owner,
      { shippingAddress },
      customer.email,
      createFakePaystackClient(),
    );

    expect(payment.outcome).toBe("PENDING");
    // The order, cart conversion, and inventory reservation are already
    // fully committed regardless of what the (fake) Paystack call does —
    // confirmed by fresh queries, not inferred from the response alone.
    const orderRow = await db.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
    });
    expect(orderRow.status).toBe("PENDING_PAYMENT");
    const cartRow = await db.cart.findUniqueOrThrow({
      where: { id: BigInt(cart.id) },
    });
    expect(cartRow.status).toBe("CONVERTED");
    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityReserved).toBe(1);
  });
});
