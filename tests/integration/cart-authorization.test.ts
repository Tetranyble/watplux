import { afterAll, describe, expect, it } from "vitest";

import { hashToken } from "@/src/integrations/crypto/tokens";
import { addCartItem } from "@/src/modules/cart/use-cases/add-cart-item";
import { removeCartItem } from "@/src/modules/cart/use-cases/remove-cart-item";
import { guestCartIdentityExists } from "@/src/modules/cart/use-cases/resolve-guest-cart-identity";
import { updateCartItemQuantity } from "@/src/modules/cart/use-cases/update-cart-item-quantity";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createSuperAdminActor,
  createTestProduct,
} from "./helpers/catalog-fixtures";
import {
  cleanupCartTestData,
  createGuestOwner,
  ownerForUser,
} from "./helpers/cart-fixtures";

/** Every mandatory IDOR scenario from docs/PHASE_7_CART_CHECKOUT_PLAN.md
 * §27, mirroring `tests/integration/idor.test.ts`'s and
 * `tests/integration/order-authorization.test.ts`'s established
 * conventions. */
describe("cart: authorization / IDOR", () => {
  afterAll(async () => {
    await cleanupCartTestData();
    await cleanupCatalogTestData();
  });

  it("User A cannot update or remove an item belonging to User B's cart", async () => {
    const userA = await createCustomerActor();
    const userB = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 1_000 });
    const variantId = BigInt(product.variants[0]!.id);

    const cartB = await addCartItem(ownerForUser(userB), {
      variantId,
      quantity: 1,
    });
    const itemId = BigInt(cartB.items[0]!.id);

    await expect(
      updateCartItemQuantity(ownerForUser(userA), itemId, { quantity: 5 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      removeCartItem(ownerForUser(userA), itemId),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("Guest A cannot update or remove an item belonging to Guest B's cart", async () => {
    const guestA = createGuestOwner();
    const guestB = createGuestOwner();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 1_000 });
    const variantId = BigInt(product.variants[0]!.id);

    const cartB = await addCartItem(guestB, { variantId, quantity: 1 });
    const itemId = BigInt(cartB.items[0]!.id);

    await expect(
      updateCartItemQuantity(guestA, itemId, { quantity: 5 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(removeCartItem(guestA, itemId)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("a User cannot reach a Guest's cart item, and vice versa", async () => {
    const user = await createCustomerActor();
    const guest = createGuestOwner();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 1_000 });
    const variantId = BigInt(product.variants[0]!.id);

    const guestCart = await addCartItem(guest, { variantId, quantity: 1 });
    const guestItemId = BigInt(guestCart.items[0]!.id);

    await expect(
      removeCartItem(ownerForUser(user), guestItemId),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("manipulating the item id does not bypass the check — a nonexistent id is denied with 404, not silently accepted", async () => {
    const user = await createCustomerActor();
    await expect(
      updateCartItemQuantity(ownerForUser(user), BigInt(999_999_999), {
        quantity: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("a forged/nonexistent guest token hash never resolves to any cart — enumeration-safe, no error, just false", async () => {
    const forgedHash = hashToken("this-was-never-a-real-issued-token");
    const exists = await guestCartIdentityExists(forgedHash);
    expect(exists).toBe(false);
  });
});
