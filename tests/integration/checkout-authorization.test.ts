import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { addCartItem } from "@/src/modules/cart/use-cases/add-cart-item";
import * as checkoutRepo from "@/src/modules/checkout/repo";
import { completeCheckout } from "@/src/modules/checkout/use-cases/complete-checkout";
import { validateCheckout } from "@/src/modules/checkout/use-cases/validate-checkout";
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
  fullName: "Checkout Auth Test",
  phone: "+2348012345678",
  addressLine1: "1 Auth Street",
  city: "Lagos",
  state: "Lagos",
  country: "NG",
};

/** Checkout has no `cartId` input parameter at all — identity resolves
 * the cart (docs/PHASE_7_CART_CHECKOUT_PLAN.md §23/§27), so "User A ->
 * User B's checkout" is structurally unreachable through the normal
 * use-case surface. These tests confirm that structural guarantee
 * directly, plus a defense-in-depth check at the repo layer (mirroring
 * `requireMatchingOrderItem`'s precedent) for a hypothetically forged
 * internal call. */
describe("checkout: authorization / IDOR", () => {
  afterAll(async () => {
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("User A's checkout only ever resolves and consumes User A's own cart, never User B's", async () => {
    const userA = await createCustomerActor();
    const userB = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId: variantAId } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const { variantId: variantBId } = await createStockedProduct(admin, {
      quantity: 5,
    });

    await addCartItem(ownerForUser(userA), {
      variantId: variantAId,
      quantity: 1,
    });
    await addCartItem(ownerForUser(userB), {
      variantId: variantBId,
      quantity: 1,
    });

    const { order: orderA } = await completeCheckout(ownerForUser(userA), {
      shippingAddress,
    });
    expect(orderA.items).toHaveLength(1);
    expect(orderA.items[0]!.productVariantId).toBe(variantAId.toString());

    // User B's cart is untouched — still ACTIVE, still has its own item.
    const cartB = await db.cart.findFirst({ where: { userId: userB.id } });
    expect(cartB?.status).toBe("ACTIVE");
    const cartBItemCount = await db.cartItem.count({
      where: { cartId: cartB!.id },
    });
    expect(cartBItemCount).toBe(1);
  });

  it("a Guest's checkout never resolves another Guest's cart", async () => {
    const guestA = createGuestOwner();
    const guestB = createGuestOwner();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    await addCartItem(guestB, { variantId, quantity: 1 });

    // Guest A has no cart at all — their checkout must fail with
    // NotFoundError, never accidentally resolving Guest B's cart.
    await expect(
      completeCheckout(guestA, {
        shippingAddress,
        guestEmail: "guest-a@example.test",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(validateCheckout(guestA)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("defense-in-depth: the repo layer itself rejects a cartId/owner mismatch, never trusting the caller's owner claim alone", async () => {
    const userA = await createCustomerActor();
    const userB = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });

    const cartA = await addCartItem(ownerForUser(userA), {
      variantId,
      quantity: 1,
    });

    // A hypothetically forged internal call: User B's owner claim paired
    // with User A's real cartId. Never reachable through the actual
    // use-case surface (which has no cartId input), but the repo's own
    // ownership check must still hold as a second, independent layer.
    await expect(
      checkoutRepo.completeCheckout({
        cartId: BigInt(cartA.id),
        owner: ownerForUser(userB),
        userId: userB.id,
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
        initialActorId: userB.id,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const cartRow = await db.cart.findUnique({
      where: { id: BigInt(cartA.id) },
    });
    expect(cartRow?.status).toBe("ACTIVE");
  });
});
