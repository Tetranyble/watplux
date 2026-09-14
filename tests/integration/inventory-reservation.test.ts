import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { completeInventorySale } from "@/src/modules/inventory/use-cases/complete-inventory-sale";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";
import { releaseInventory } from "@/src/modules/inventory/use-cases/release-inventory";
import { reserveInventory } from "@/src/modules/inventory/use-cases/reserve-inventory";
import { restockInventory } from "@/src/modules/inventory/use-cases/restock-inventory";
import {
  cleanupCatalogTestData,
  createSuperAdminActor,
  createTestProduct,
} from "./helpers/catalog-fixtures";
import {
  cleanupInventoryTestData,
  createTestOrderWithItem,
} from "./helpers/inventory-fixtures";

/**
 * The inter-module contracts `reserveInventory`/`releaseInventory`/
 * `completeInventorySale` (docs/PHASE_5_INVENTORY_PLAN.md §9/§15) — no
 * actor, no HTTP route. Includes the MANDATORY order-item/variant
 * mismatch tests added during implementation kickoff: the FK on
 * `inventory_movements.order_item_id` only proves the referenced order
 * item exists, never that it names the same variant as the inventory
 * item being mutated — `requireMatchingOrderItem` in repo.ts enforces
 * this explicitly, tested here against real MySQL.
 */
describe("inventory: reserve / release / sale (inter-module contracts)", () => {
  afterAll(async () => {
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  // ---------------------------------------------------------------------
  // Mandatory order-item/variant mismatch tests (user's critical
  // correction — three required scenarios).
  // ---------------------------------------------------------------------

  it("[MANDATORY 1/3] reserveInventory succeeds when the order item genuinely belongs to the variant", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });

    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "3",
    });

    const movement = await reserveInventory({
      orderItemId,
      variantId,
      quantity: 3,
    });
    expect(movement.type).toBe("RESERVE");
    expect(movement.reservedDelta).toBe(3);

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityReserved).toBe(3);
    expect(balance.quantityAvailable).toBe(7);
  });

  it("[MANDATORY 2/3] reserveInventory rejects a nonexistent order item, without changing inventory", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });

    const nonexistentOrderItemId = BigInt("999999999999");

    await expect(
      reserveInventory({
        orderItemId: nonexistentOrderItemId,
        variantId,
        quantity: 3,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityReserved).toBe(0);
    expect(balance.quantityAvailable).toBe(10);
  });

  it(
    "[MANDATORY 3/3] reserveInventory rejects an order item that belongs to a DIFFERENT variant, " +
      "without changing the target variant's inventory " +
      "(OrderItem A -> Variant A; Inventory -> Variant B; RESERVE(OrderItem A, Variant B) must fail)",
    async () => {
      const admin = await createSuperAdminActor();

      // Variant A: the order item's true, correct variant.
      const productA = await createTestProduct(admin);
      const variantAId = BigInt(productA.variants[0]!.id);
      await restockInventory(admin, variantAId, { quantity: 10 });
      const { orderItemId: orderItemForA } = await createTestOrderWithItem(
        admin,
        { product: productA, quantity: "2" },
      );

      // Variant B: a completely different variant/inventory item.
      const productB = await createTestProduct(admin);
      const variantBId = BigInt(productB.variants[0]!.id);
      await restockInventory(admin, variantBId, { quantity: 20 });

      // Attempt to reserve against Variant B using OrderItem A (which
      // belongs to Variant A) — must fail cleanly, must not touch either
      // variant's inventory.
      await expect(
        reserveInventory({
          orderItemId: orderItemForA,
          variantId: variantBId,
          quantity: 2,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      const balanceA = await getInventoryForVariant(admin, variantAId);
      const balanceB = await getInventoryForVariant(admin, variantBId);
      expect(balanceA.quantityReserved).toBe(0);
      expect(balanceA.quantityOnHand).toBe(10);
      expect(balanceB.quantityReserved).toBe(0);
      expect(balanceB.quantityOnHand).toBe(20);

      // No RESERVE movement was ever inserted for either inventory item.
      const movements = await db.inventoryMovement.findMany({
        where: { orderItemId: orderItemForA, type: "RESERVE" },
      });
      expect(movements).toHaveLength(0);
    },
  );

  it("reserveInventory rejects a quantity that doesn't match the order item's committed quantity", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "3",
    });

    await expect(
      reserveInventory({ orderItemId, variantId, quantity: 5 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("reserveInventory rejects when available stock is insufficient", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 2 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "5",
    });

    await expect(
      reserveInventory({ orderItemId, variantId, quantity: 5 }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityReserved).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------

  it("a duplicate reserveInventory call for the same order item returns the existing RESERVE movement, does not double-reserve", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "4",
    });

    const first = await reserveInventory({
      orderItemId,
      variantId,
      quantity: 4,
    });
    const second = await reserveInventory({
      orderItemId,
      variantId,
      quantity: 4,
    });

    expect(second.id).toBe(first.id);

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityReserved).toBe(4);

    const movements = await db.inventoryMovement.findMany({
      where: { orderItemId, type: "RESERVE" },
    });
    expect(movements).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // Release
  // ---------------------------------------------------------------------

  it("releaseInventory undoes an existing reservation and rejects releasing without one", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "6",
    });

    await reserveInventory({ orderItemId, variantId, quantity: 6 });
    const releaseMovement = await releaseInventory({ orderItemId });
    expect(releaseMovement.type).toBe("RELEASE");
    expect(releaseMovement.reservedDelta).toBe(-6);

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityReserved).toBe(0);
    expect(balance.quantityAvailable).toBe(10);
  });

  it("releaseInventory rejects an order item with no existing reservation", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "1",
    });

    await expect(releaseInventory({ orderItemId })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("a duplicate releaseInventory call returns the existing RELEASE movement, does not double-release", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "4",
    });
    await reserveInventory({ orderItemId, variantId, quantity: 4 });

    const first = await releaseInventory({ orderItemId });
    const second = await releaseInventory({ orderItemId });
    expect(second.id).toBe(first.id);

    const movements = await db.inventoryMovement.findMany({
      where: { orderItemId, type: "RELEASE" },
    });
    expect(movements).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // Sale
  // ---------------------------------------------------------------------

  it("completeInventorySale converts a reservation into a permanent decrement of both on-hand and reserved", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "4",
    });
    await reserveInventory({ orderItemId, variantId, quantity: 4 });

    const saleMovement = await completeInventorySale({ orderItemId });
    expect(saleMovement.type).toBe("SALE");
    expect(saleMovement.onHandDelta).toBe(-4);
    expect(saleMovement.reservedDelta).toBe(-4);

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(6);
    expect(balance.quantityReserved).toBe(0);
    expect(balance.quantityAvailable).toBe(6);
  });

  it("completeInventorySale rejects an order item with no existing reservation", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "1",
    });

    await expect(completeInventorySale({ orderItemId })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("a duplicate completeInventorySale call returns the existing SALE movement, does not double-deduct", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "4",
    });
    await reserveInventory({ orderItemId, variantId, quantity: 4 });

    const first = await completeInventorySale({ orderItemId });
    const second = await completeInventorySale({ orderItemId });
    expect(second.id).toBe(first.id);

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(6);

    const movements = await db.inventoryMovement.findMany({
      where: { orderItemId, type: "SALE" },
    });
    expect(movements).toHaveLength(1);
  });

  it("releaseInventory after a completed sale is rejected (nothing left reserved to release)", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "4",
    });
    await reserveInventory({ orderItemId, variantId, quantity: 4 });
    await completeInventorySale({ orderItemId });

    // releaseInventory looks for an existing RESERVE movement to derive its
    // quantity from — one still exists (RESERVE rows are never deleted,
    // the ledger is append-only) — so this call returns the *idempotent*
    // path only if a RELEASE already existed; since none does, it will
    // attempt a genuine release and hit the "insufficient reserved"
    // guard, since SALE already brought quantityReserved to 0.
    await expect(releaseInventory({ orderItemId })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
