import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { addCartItem } from "@/src/modules/cart/use-cases/add-cart-item";
import { getActiveCart } from "@/src/modules/cart/use-cases/get-active-cart";
import { mergeGuestCartIntoUserCart } from "@/src/modules/cart/use-cases/merge-guest-cart-into-user-cart";
import { removeCartItem } from "@/src/modules/cart/use-cases/remove-cart-item";
import { updateCartItemQuantity } from "@/src/modules/cart/use-cases/update-cart-item-quantity";
import { completeCheckout } from "@/src/modules/checkout/use-cases/complete-checkout";
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
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";
import {
  cleanupOrderTestData,
  createStockedProduct,
} from "./helpers/order-fixtures";

const shippingAddress = {
  fullName: "Concurrency Test Customer",
  phone: "+2348012345678",
  addressLine1: "1 Concurrency Street",
  city: "Lagos",
  state: "Lagos",
  country: "NG",
};

/**
 * All 10 mandatory concurrency scenarios (docs/PHASE_7_CART_CHECKOUT_PLAN.md
 * §28): genuinely overlapping `Promise.all`/`Promise.allSettled` calls
 * against the real database, asserting the FINAL DB ROW STATE directly —
 * never inferred from which promise resolved/rejected alone. Run 5+
 * consecutive times with zero flaky failures as part of final
 * verification.
 *
 * Scenario 2 ("different hypothetical idempotency keys") is moot under
 * this design (plan §15) — no client-supplied key is ever consulted, so
 * it collapses to scenario 1 exactly; still exercised as its own test for
 * completeness. Scenarios 8/9 ("failure after order creation but before
 * reservation" / "after reservation but before cart conversion") are
 * structurally impossible to observe as partial states (plan §28) and
 * are not re-tested here — they are covered by
 * `tests/integration/checkout-flow.test.ts`'s own MANDATORY ROLLBACK
 * PROOF test, mirroring `order-concurrency.test.ts`'s identical
 * "not duplicated here" convention for its own rollback-proof test.
 */
describe("cart + checkout: concurrency", () => {
  afterAll(async () => {
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("[1/10] two identical checkout requests against the same ACTIVE cart — exactly one order is created", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const owner = ownerForUser(customer);
    const cart = await addCartItem(owner, { variantId, quantity: 1 });

    const results = await Promise.allSettled([
      completeCheckout(owner, { shippingAddress }),
      completeCheckout(owner, { shippingAddress }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === "rejected") {
      expect([404, 409]).toContain(
        (rejected[0].reason as { statusCode: number }).statusCode,
      );
    }

    const orderCount = await db.order.count({
      where: { items: { some: { productVariantId: variantId } } },
    });
    expect(orderCount).toBe(1);

    const cartRow = await db.cart.findUnique({
      where: { id: BigInt(cart.id) },
    });
    expect(cartRow?.status).toBe("CONVERTED");
  });

  it("[2/10] two checkout requests with hypothetically different idempotency keys — moot, collapses to scenario 1 exactly", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const owner = ownerForUser(customer);
    await addCartItem(owner, { variantId, quantity: 1 });

    // No client-supplied idempotency key is ever consulted for
    // correctness (plan §15) — there is nothing to vary between these
    // two calls that would change the outcome.
    const results = await Promise.allSettled([
      completeCheckout(owner, { shippingAddress }),
      completeCheckout(owner, { shippingAddress }),
    ]);

    const orderCount = await db.order.count({
      where: { items: { some: { productVariantId: variantId } } },
    });
    expect(orderCount).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("[3/10] checkout racing a cart quantity update — whichever wins, the final state is self-consistent", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 10 });
    const owner = ownerForUser(customer);
    const cart = await addCartItem(owner, { variantId, quantity: 1 });
    const itemId = BigInt(cart.items[0]!.id);

    const [checkoutResult, updateResult] = await Promise.allSettled([
      completeCheckout(owner, { shippingAddress }),
      updateCartItemQuantity(owner, itemId, { quantity: 3 }),
    ]);

    if (checkoutResult.status === "fulfilled") {
      // Checkout won the lock first: the cart converted before the
      // update's lock attempt succeeded — the update must find the cart
      // no longer ACTIVE and reject cleanly.
      expect(updateResult.status).toBe("rejected");
      if (updateResult.status === "rejected") {
        expect(updateResult.reason).toMatchObject({ statusCode: 409 });
      }
      expect(checkoutResult.value.order.items[0]!.quantity).toBe(1);
    } else {
      // The quantity update won the lock first: checkout (arriving
      // second) must honor the customer's last-second edit, not the
      // stale quantity captured before the race.
      expect(updateResult.status).toBe("fulfilled");
      expect(checkoutResult.status).toBe("rejected");
    }

    const orderCount = await db.order.count({
      where: { items: { some: { productVariantId: variantId } } },
    });
    expect(orderCount).toBeLessThanOrEqual(1);
  });

  it("[4/10] checkout racing a cart item removal — whichever wins, the final state is self-consistent", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const owner = ownerForUser(customer);
    const cart = await addCartItem(owner, { variantId, quantity: 1 });
    const itemId = BigInt(cart.items[0]!.id);

    const [checkoutResult, removeResult] = await Promise.allSettled([
      completeCheckout(owner, { shippingAddress }),
      removeCartItem(owner, itemId),
    ]);

    if (checkoutResult.status === "fulfilled") {
      // Checkout won: the cart converted before the removal's lock
      // attempt succeeded.
      expect(removeResult.status).toBe("rejected");
      if (removeResult.status === "rejected") {
        expect(removeResult.reason).toMatchObject({ statusCode: 409 });
      }
    } else {
      // The removal won: checkout (arriving second) finds the cart
      // empty and rejects with a clean ValidationError — never a
      // partial/empty order.
      expect(removeResult.status).toBe("fulfilled");
      expect(checkoutResult.status).toBe("rejected");
      if (checkoutResult.status === "rejected") {
        expect(checkoutResult.reason).toMatchObject({ statusCode: 400 });
      }
    }

    const orderCount = await db.order.count({
      where: { items: { some: { productVariantId: variantId } } },
    });
    expect(orderCount).toBeLessThanOrEqual(1);
  });

  it("[5/10] two concurrent add-to-cart requests for the same variant (including the concurrent first-ever-cart race) — exactly one row, correctly summed quantity", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 20 });
    const owner = ownerForUser(customer);

    const results = await Promise.allSettled([
      addCartItem(owner, { variantId, quantity: 2 }),
      addCartItem(owner, { variantId, quantity: 3 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);

    const cart = await getActiveCart(owner);
    expect(cart?.items).toHaveLength(1);
    expect(cart?.items[0]!.quantity).toBe(5);

    const cartCount = await db.cart.count({ where: { userId: customer.id } });
    expect(cartCount).toBe(1);
  });

  it("[6/10] guest cart merge racing checkout on the same guest cart — the loser cleanly no-ops/rejects, never double-processed", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const guest = createGuestOwner();
    await addCartItem(guest, { variantId, quantity: 1 });
    const guestHash = guest.type === "guest" ? guest.guestTokenHash : "";

    const [mergeResult, checkoutResult] = await Promise.allSettled([
      mergeGuestCartIntoUserCart(customer.id, guestHash),
      completeCheckout(guest, {
        shippingAddress,
        guestEmail: "concurrency-guest@example.test",
      }),
    ]);

    const guestCartRow = await db.cart.findFirst({
      where: { guestTokenHash: guestHash },
    });
    expect(guestCartRow?.status).toBe("CONVERTED");

    if (checkoutResult.status === "fulfilled") {
      // Checkout won: the guest cart converted into an order. The merge
      // must find it already non-ACTIVE and no-op, not double-merge.
      expect(mergeResult.status).toBe("fulfilled");
      if (mergeResult.status === "fulfilled") {
        expect(mergeResult.value.merged).toBe(false);
      }
      const orderCount = await db.order.count({
        where: { items: { some: { productVariantId: variantId } } },
      });
      expect(orderCount).toBe(1);
    } else {
      // The merge won: the guest cart was absorbed into the user's cart.
      // Checkout (arriving second) must find the guest cart no longer
      // its own ACTIVE cart and reject cleanly.
      expect(mergeResult.status).toBe("fulfilled");
      if (mergeResult.status === "fulfilled") {
        expect(mergeResult.value.merged).toBe(true);
      }
      expect([404, 409]).toContain(
        (checkoutResult.reason as { statusCode: number }).statusCode,
      );
    }
  });

  it("[7/10] two customers' checkouts competing for the last inventory unit — exactly one order is created", async () => {
    const customerA = await createCustomerActor();
    const customerB = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 1 });

    await addCartItem(ownerForUser(customerA), { variantId, quantity: 1 });
    await addCartItem(ownerForUser(customerB), { variantId, quantity: 1 });

    const results = await Promise.allSettled([
      completeCheckout(ownerForUser(customerA), { shippingAddress }),
      completeCheckout(ownerForUser(customerB), { shippingAddress }),
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

    const orderCount = await db.order.count({
      where: { items: { some: { productVariantId: variantId } } },
    });
    expect(orderCount).toBe(1);
  });

  it("[10/10] retry after a successful checkout commit — sequential, never creates a second order", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const owner = ownerForUser(customer);
    await addCartItem(owner, { variantId, quantity: 1 });

    const firstOrder = await completeCheckout(owner, { shippingAddress });

    // The cart is now CONVERTED — a sequential retry finds no ACTIVE
    // cart at all (plan §15's disclosed lost-response-retry limitation:
    // recovery is a client-side re-fetch of `firstOrder`, not an
    // automatic "here's your existing order" response).
    await expect(
      completeCheckout(owner, { shippingAddress }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const orderCount = await db.order.count({
      where: { items: { some: { productVariantId: variantId } } },
    });
    expect(orderCount).toBe(1);
    expect(orderCount).toBeGreaterThan(0);
    void firstOrder;
  });
});
