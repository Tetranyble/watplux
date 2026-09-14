import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { archiveVariant } from "@/src/modules/catalog/use-cases/archive-variant";
import { addCartItem } from "@/src/modules/cart/use-cases/add-cart-item";
import { clearCart } from "@/src/modules/cart/use-cases/clear-cart";
import { getActiveCart } from "@/src/modules/cart/use-cases/get-active-cart";
import { getCartItemCount } from "@/src/modules/cart/use-cases/get-cart-item-count";
import { removeCartItem } from "@/src/modules/cart/use-cases/remove-cart-item";
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

describe("cart: management", () => {
  afterAll(async () => {
    await cleanupCartTestData();
    await cleanupCatalogTestData();
  });

  it("getActiveCart returns null for a brand-new identity — absence is a normal state, not an error", async () => {
    const owner = createGuestOwner();
    const cart = await getActiveCart(owner);
    expect(cart).toBeNull();
    expect(await getCartItemCount(owner)).toBe(0);
  });

  it("addCartItem lazily creates the cart on first use, for an authenticated user", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 50_000 });
    const variantId = BigInt(product.variants[0]!.id);
    const owner = ownerForUser(customer);

    const cart = await addCartItem(owner, { variantId, quantity: 2 });
    expect(cart.status).toBe("ACTIVE");
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(2);
    expect(cart.items[0]!.priceSnapshotMinor).toBe(50_000);
    expect(cart.items[0]!.lineDisplayTotalMinor).toBe(100_000);

    const reread = await getActiveCart(owner);
    expect(reread?.id).toBe(cart.id);
    expect(await getCartItemCount(owner)).toBe(1);
  });

  it("addCartItem lazily creates the cart for a guest identity too", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 20_000 });
    const variantId = BigInt(product.variants[0]!.id);
    const owner = createGuestOwner();

    const cart = await addCartItem(owner, { variantId, quantity: 1 });
    expect(cart.items).toHaveLength(1);

    const reread = await getActiveCart(owner);
    expect(reread?.id).toBe(cart.id);
  });

  it("adding the same variant again increments quantity — never a duplicate row (uq_cart_items_cart_variant)", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 10_000 });
    const variantId = BigInt(product.variants[0]!.id);
    const owner = ownerForUser(customer);

    await addCartItem(owner, { variantId, quantity: 1 });
    const cart = await addCartItem(owner, { variantId, quantity: 2 });

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(3);

    const rowCount = await db.cartItem.count({
      where: { cartId: BigInt(cart.id), productVariantId: variantId },
    });
    expect(rowCount).toBe(1);
  });

  it("addCartItem rejects an archived variant", async () => {
    const { createVariant } =
      await import("@/src/modules/catalog/use-cases/create-variant");
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 10_000 });
    // Catalog forbids archiving a product's LAST active variant — add a
    // second variant first so the one under test can be archived.
    await createVariant(admin, {
      productId: BigInt(product.id),
      sku: `PHASE4TEST-SKU-EXTRA-${Date.now()}`,
      priceMinor: 10_000,
    });
    const variantId = BigInt(product.variants[0]!.id);
    await archiveVariant(admin, variantId);

    await expect(
      addCartItem(ownerForUser(customer), { variantId, quantity: 1 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("addCartItem rejects a nonexistent variant", async () => {
    const customer = await createCustomerActor();
    await expect(
      addCartItem(ownerForUser(customer), {
        variantId: BigInt(999_999_999),
        quantity: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("updateCartItemQuantity sets an exact new quantity and refreshes priceSnapshotMinor", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 10_000 });
    const variantId = BigInt(product.variants[0]!.id);
    const owner = ownerForUser(customer);

    const created = await addCartItem(owner, { variantId, quantity: 1 });
    const itemId = BigInt(created.items[0]!.id);

    const updated = await updateCartItemQuantity(owner, itemId, {
      quantity: 5,
    });
    expect(updated.items[0]!.quantity).toBe(5);
    expect(updated.items[0]!.priceSnapshotMinor).toBe(10_000);
  });

  it("updateCartItemQuantity refreshes the stored price if the catalog price changed since add-time", async () => {
    const { updateVariant } =
      await import("@/src/modules/catalog/use-cases/update-variant");
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 10_000 });
    const variantId = BigInt(product.variants[0]!.id);
    const owner = ownerForUser(customer);

    const created = await addCartItem(owner, { variantId, quantity: 1 });
    expect(created.items[0]!.priceSnapshotMinor).toBe(10_000);

    await updateVariant(admin, variantId, { priceMinor: 15_000 });

    const updated = await updateCartItemQuantity(
      owner,
      BigInt(created.items[0]!.id),
      { quantity: 1 },
    );
    expect(updated.items[0]!.priceSnapshotMinor).toBe(15_000);
  });

  it("a bare read (getActiveCart) never refreshes the stored price — reads must not mutate", async () => {
    const { updateVariant } =
      await import("@/src/modules/catalog/use-cases/update-variant");
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 10_000 });
    const variantId = BigInt(product.variants[0]!.id);
    const owner = ownerForUser(customer);

    await addCartItem(owner, { variantId, quantity: 1 });
    await updateVariant(admin, variantId, { priceMinor: 99_000 });

    const read = await getActiveCart(owner);
    expect(read?.items[0]!.priceSnapshotMinor).toBe(10_000);
  });

  it("removeCartItem removes exactly the targeted item", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const productA = await createTestProduct(admin, { priceMinor: 1_000 });
    const productB = await createTestProduct(admin, { priceMinor: 2_000 });
    const owner = ownerForUser(customer);

    await addCartItem(owner, {
      variantId: BigInt(productA.variants[0]!.id),
      quantity: 1,
    });
    const cart = await addCartItem(owner, {
      variantId: BigInt(productB.variants[0]!.id),
      quantity: 1,
    });
    expect(cart.items).toHaveLength(2);

    const itemToRemove = cart.items.find(
      (i) => i.productVariantId === productA.variants[0]!.id.toString(),
    )!;
    const after = await removeCartItem(owner, BigInt(itemToRemove.id));
    expect(after.items).toHaveLength(1);
    expect(after.items[0]!.productVariantId).toBe(
      productB.variants[0]!.id.toString(),
    );
  });

  it("removeCartItem on an already-removed item returns NotFoundError, cart itself untouched", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 1_000 });
    const owner = ownerForUser(customer);

    const cart = await addCartItem(owner, {
      variantId: BigInt(product.variants[0]!.id),
      quantity: 1,
    });
    const itemId = BigInt(cart.items[0]!.id);
    await removeCartItem(owner, itemId);

    await expect(removeCartItem(owner, itemId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("clearCart empties every item but the cart itself remains ACTIVE", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 1_000 });
    const owner = ownerForUser(customer);

    await addCartItem(owner, {
      variantId: BigInt(product.variants[0]!.id),
      quantity: 3,
    });
    const cleared = await clearCart(owner);
    expect(cleared?.items).toHaveLength(0);
    expect(cleared?.status).toBe("ACTIVE");
  });

  it("clearCart on a nonexistent cart is a no-op (null), not an error", async () => {
    const owner = createGuestOwner();
    const result = await clearCart(owner);
    expect(result).toBeNull();
  });

  it("clearing an already-empty cart is a no-op", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 1_000 });
    const owner = ownerForUser(customer);
    await addCartItem(owner, {
      variantId: BigInt(product.variants[0]!.id),
      quantity: 1,
    });
    await clearCart(owner);
    const secondClear = await clearCart(owner);
    expect(secondClear?.items).toHaveLength(0);
  });

  it("updateCartItemQuantity/removeCartItem on a cart that was never created returns NotFoundError", async () => {
    const owner = createGuestOwner();
    await expect(
      updateCartItemQuantity(owner, BigInt(1), { quantity: 1 }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(removeCartItem(owner, BigInt(1))).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("cart mutations never call Inventory — no reservation, no movement rows, for any cart operation", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 1_000 });
    const variantId = BigInt(product.variants[0]!.id);
    const owner = ownerForUser(customer);

    const cart = await addCartItem(owner, { variantId, quantity: 5 });
    await updateCartItemQuantity(owner, BigInt(cart.items[0]!.id), {
      quantity: 10,
    });

    const movementCount = await db.inventoryMovement.count({
      where: {
        inventoryItem: { productVariantId: variantId },
      },
    });
    expect(movementCount).toBe(0);
  });
});
