import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { adjustInventory } from "@/src/modules/inventory/use-cases/adjust-inventory";
import { getAvailableQuantity } from "@/src/modules/inventory/use-cases/get-available-quantity";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";
import { getInventoryMovementHistory } from "@/src/modules/inventory/use-cases/get-inventory-movement-history";
import { listInventory } from "@/src/modules/inventory/use-cases/list-inventory";
import { recordInventoryReturn } from "@/src/modules/inventory/use-cases/record-inventory-return";
import { restockInventory } from "@/src/modules/inventory/use-cases/restock-inventory";
import {
  cleanupCatalogTestData,
  createStaffActor,
  createSuperAdminActor,
  createTestProduct,
} from "./helpers/catalog-fixtures";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";

/**
 * RESTOCK / ADJUSTMENT / RETURN and the read paths
 * (docs/PHASE_5_INVENTORY_PLAN.md §7/§11/§12) — real MySQL, no mocks.
 * Reserve/release/sale (including the mandatory order-item/variant
 * mismatch cases) are covered separately in
 * `inventory-reservation.test.ts`.
 */
describe("inventory: restock, adjustment, return, and reads", () => {
  afterAll(async () => {
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("returns NotFoundError for a variant with no inventory tracked yet", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);

    await expect(
      getInventoryForVariant(admin, variantId),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("getAvailableQuantity returns 0 (not an error) for an untracked variant", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);

    await expect(getAvailableQuantity(variantId)).resolves.toBe(0);
  });

  it("first-ever restock creates the InventoryItem row with the correct on-hand quantity", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);

    const movement = await restockInventory(admin, variantId, {
      quantity: 50,
    });
    expect(movement.type).toBe("RESTOCK");
    expect(movement.onHandDelta).toBe(50);
    expect(movement.reservedDelta).toBe(0);

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(50);
    expect(balance.quantityReserved).toBe(0);
    expect(balance.quantityAvailable).toBe(50);
  });

  it("a second restock increments the existing row rather than creating a duplicate", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);

    await restockInventory(admin, variantId, { quantity: 20 });
    await restockInventory(admin, variantId, { quantity: 15 });

    const rows = await db.inventoryItem.findMany({
      where: { productVariantId: variantId },
    });
    expect(rows).toHaveLength(1);

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(35);
  });

  it("restock also writes an audit_logs row in the same transaction", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);

    const movement = await restockInventory(admin, variantId, {
      quantity: 10,
    });

    const auditRows = await db.auditLog.findMany({
      where: { entityType: "inventory_item", action: "inventory.restock" },
      orderBy: { id: "desc" },
      take: 5,
    });
    const match = auditRows.find(
      (row) => row.entityId.toString() === movement.inventoryItemId,
    );
    expect(match).toBeDefined();
    expect(match?.actorId?.toString()).toBe(admin.id.toString());
  });

  it("adjustInventory by delta increases on-hand and rejects a negative-result delta", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });

    const movement = await adjustInventory(admin, variantId, {
      delta: 5,
      note: "Stocktake correction",
    });
    expect(movement.type).toBe("ADJUSTMENT");
    expect(movement.onHandDelta).toBe(5);

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(15);

    await expect(
      adjustInventory(admin, variantId, {
        delta: -100,
        note: "Would go negative",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const unchanged = await getInventoryForVariant(admin, variantId);
    expect(unchanged.quantityOnHand).toBe(15);
  });

  it("adjustInventory by newQuantity (absolute target) computes the correct delta via SELECT FOR UPDATE", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });

    const movement = await adjustInventory(admin, variantId, {
      newQuantity: 30,
      note: "Set to 30 after count",
    });
    expect(movement.onHandDelta).toBe(20);

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(30);
  });

  it("adjustInventory rejects newQuantity equal to the current on-hand quantity (zero delta)", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });

    await expect(
      adjustInventory(admin, variantId, {
        newQuantity: 10,
        note: "No actual change",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("recordInventoryReturn increases on-hand and permits repeats (no dedup constraint)", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });

    await recordInventoryReturn(admin, variantId, { quantity: 3 });
    await recordInventoryReturn(admin, variantId, { quantity: 2 });

    const balance = await getInventoryForVariant(admin, variantId);
    expect(balance.quantityOnHand).toBe(15);

    const movements = await db.inventoryMovement.findMany({
      where: { inventoryItemId: BigInt(balance.id), type: "RETURN" },
    });
    expect(movements).toHaveLength(2);
  });

  it("listInventory paginates and lowStockOnly filters via the generated quantity_available column", async () => {
    const admin = await createSuperAdminActor();
    const lowStockProduct = await createTestProduct(admin);
    const lowStockVariantId = BigInt(lowStockProduct.variants[0]!.id);
    await restockInventory(admin, lowStockVariantId, { quantity: 2 });
    await db.inventoryItem.update({
      where: { productVariantId: lowStockVariantId },
      data: { lowStockThreshold: 5 },
    });

    const highStockProduct = await createTestProduct(admin);
    const highStockVariantId = BigInt(highStockProduct.variants[0]!.id);
    await restockInventory(admin, highStockVariantId, { quantity: 100 });
    await db.inventoryItem.update({
      where: { productVariantId: highStockVariantId },
      data: { lowStockThreshold: 5 },
    });

    const page = await listInventory(admin, {
      limit: 100,
      lowStockOnly: false,
    });
    const ids = page.items.map((i) => i.productVariantId);
    expect(ids).toContain(lowStockVariantId.toString());
    expect(ids).toContain(highStockVariantId.toString());

    const lowStockPage = await listInventory(admin, {
      limit: 100,
      lowStockOnly: true,
    });
    const lowStockIds = lowStockPage.items.map((i) => i.productVariantId);
    expect(lowStockIds).toContain(lowStockVariantId.toString());
    expect(lowStockIds).not.toContain(highStockVariantId.toString());
  });

  it("getInventoryMovementHistory returns newest-first, keyset-paginated", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 1 });
    await restockInventory(admin, variantId, { quantity: 1 });
    await restockInventory(admin, variantId, { quantity: 1 });

    const balance = await getInventoryForVariant(admin, variantId);
    const firstPage = await getInventoryMovementHistory(
      admin,
      BigInt(balance.id),
      { limit: 2 },
    );
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await getInventoryMovementHistory(
      admin,
      BigInt(balance.id),
      { limit: 2, cursor: firstPage.nextCursor ?? undefined },
    );
    expect(secondPage.items.length).toBeGreaterThanOrEqual(1);

    const firstIds = new Set(firstPage.items.map((m) => m.id));
    for (const item of secondPage.items) {
      expect(firstIds.has(item.id)).toBe(false);
    }
  });

  it("a staff actor (inventory.read only, per prisma/seed-data.ts) can read balances but not restock", async () => {
    const staff = await createStaffActor();
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 5 });

    await expect(
      getInventoryForVariant(staff, variantId),
    ).resolves.toMatchObject({ quantityOnHand: 5 });

    await expect(
      restockInventory(staff, variantId, { quantity: 5 }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
