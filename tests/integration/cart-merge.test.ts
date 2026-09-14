import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { archiveVariant } from "@/src/modules/catalog/use-cases/archive-variant";
import { createVariant } from "@/src/modules/catalog/use-cases/create-variant";
import { addCartItem } from "@/src/modules/cart/use-cases/add-cart-item";
import { getActiveCart } from "@/src/modules/cart/use-cases/get-active-cart";
import { mergeGuestCartIntoUserCart } from "@/src/modules/cart/use-cases/merge-guest-cart-into-user-cart";
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

describe("cart: guest -> authenticated merge", () => {
  afterAll(async () => {
    await cleanupCartTestData();
    await cleanupCatalogTestData();
  });

  it("user has no ACTIVE cart, guest cart exists: guest items land in a fresh user cart", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 5_000 });
    const variantId = BigInt(product.variants[0]!.id);
    const guest = createGuestOwner();

    await addCartItem(guest, { variantId, quantity: 2 });

    const result = await mergeGuestCartIntoUserCart(
      customer.id,
      guest.type === "guest" ? guest.guestTokenHash : "",
    );
    expect(result.merged).toBe(true);

    const userCart = await getActiveCart(ownerForUser(customer));
    expect(userCart?.items).toHaveLength(1);
    expect(userCart?.items[0]!.quantity).toBe(2);

    const guestCartRow = await db.cart.findFirst({
      where: {
        guestTokenHash: guest.type === "guest" ? guest.guestTokenHash : "",
      },
    });
    expect(guestCartRow?.status).toBe("CONVERTED");
  });

  it("user already has an ACTIVE cart with the same variant: quantities are summed", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 5_000 });
    const variantId = BigInt(product.variants[0]!.id);
    const guest = createGuestOwner();

    await addCartItem(ownerForUser(customer), { variantId, quantity: 3 });
    await addCartItem(guest, { variantId, quantity: 4 });

    const result = await mergeGuestCartIntoUserCart(
      customer.id,
      guest.type === "guest" ? guest.guestTokenHash : "",
    );
    expect(result.merged).toBe(true);

    const userCart = await getActiveCart(ownerForUser(customer));
    expect(userCart?.items).toHaveLength(1);
    expect(userCart?.items[0]!.quantity).toBe(7);
  });

  it("different variants in each cart: both survive as separate lines", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const productA = await createTestProduct(admin, { priceMinor: 1_000 });
    const productB = await createTestProduct(admin, { priceMinor: 2_000 });
    const guest = createGuestOwner();

    await addCartItem(ownerForUser(customer), {
      variantId: BigInt(productA.variants[0]!.id),
      quantity: 1,
    });
    await addCartItem(guest, {
      variantId: BigInt(productB.variants[0]!.id),
      quantity: 1,
    });

    await mergeGuestCartIntoUserCart(
      customer.id,
      guest.type === "guest" ? guest.guestTokenHash : "",
    );

    const userCart = await getActiveCart(ownerForUser(customer));
    expect(userCart?.items).toHaveLength(2);
  });

  it("an inactive/archived guest-cart variant is dropped, not merged", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 1_000 });
    await createVariant(admin, {
      productId: BigInt(product.id),
      sku: `PHASE4TEST-SKU-EXTRA-${Date.now()}`,
      priceMinor: 1_000,
    });
    const variantId = BigInt(product.variants[0]!.id);
    const guest = createGuestOwner();

    await addCartItem(guest, { variantId, quantity: 1 });
    await archiveVariant(admin, variantId);

    const result = await mergeGuestCartIntoUserCart(
      customer.id,
      guest.type === "guest" ? guest.guestTokenHash : "",
    );
    expect(result.merged).toBe(true);

    const userCart = await getActiveCart(ownerForUser(customer));
    expect(userCart?.items ?? []).toHaveLength(0);
  });

  it("merging an already-CONVERTED guest cart is a no-op, not an error", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 1_000 });
    const guest = createGuestOwner();
    await addCartItem(guest, {
      variantId: BigInt(product.variants[0]!.id),
      quantity: 1,
    });

    const first = await mergeGuestCartIntoUserCart(
      customer.id,
      guest.type === "guest" ? guest.guestTokenHash : "",
    );
    expect(first.merged).toBe(true);

    const second = await mergeGuestCartIntoUserCart(
      customer.id,
      guest.type === "guest" ? guest.guestTokenHash : "",
    );
    expect(second.merged).toBe(false);
  });

  it("merging when no guest cart exists at all is a no-op", async () => {
    const customer = await createCustomerActor();
    const result = await mergeGuestCartIntoUserCart(
      customer.id,
      "0000000000000000000000000000000000000000000000000000000000000000".slice(
        0,
        64,
      ),
    );
    expect(result.merged).toBe(false);
  });

  it("stale price at guest add-time is refreshed to current price during merge", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin, { priceMinor: 1_000 });
    const variantId = BigInt(product.variants[0]!.id);
    const guest = createGuestOwner();
    await addCartItem(guest, { variantId, quantity: 1 });

    const { updateVariant } =
      await import("@/src/modules/catalog/use-cases/update-variant");
    await updateVariant(admin, variantId, { priceMinor: 9_000 });

    await mergeGuestCartIntoUserCart(
      customer.id,
      guest.type === "guest" ? guest.guestTokenHash : "",
    );

    const userCart = await getActiveCart(ownerForUser(customer));
    expect(userCart?.items[0]!.priceSnapshotMinor).toBe(9_000);
  });
});
