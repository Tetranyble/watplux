import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { adjustInventory } from "@/src/modules/inventory/use-cases/adjust-inventory";
import { releaseInventory } from "@/src/modules/inventory/use-cases/release-inventory";
import { reserveInventory } from "@/src/modules/inventory/use-cases/reserve-inventory";
import { restockInventory } from "@/src/modules/inventory/use-cases/restock-inventory";
import { completeInventorySale } from "@/src/modules/inventory/use-cases/complete-inventory-sale";
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
 * The 7 mandatory concurrency scenarios (implementation-kickoff
 * requirement): genuinely overlapping `Promise.all`/`Promise.allSettled`
 * calls against the real database, asserting the FINAL DB ROW STATE
 * directly — never inferred from which promise resolved/rejected alone.
 * Run 5+ consecutive times with zero flaky failures as part of final
 * verification (see docs/PHASE_5_INVENTORY_IMPLEMENTATION.md).
 */
describe("inventory: concurrency", () => {
  afterAll(async () => {
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("[1/7] two reservations competing for the last available unit — exactly one wins", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 1 });

    const { orderItemId: orderItemA } = await createTestOrderWithItem(admin, {
      product,
      quantity: "1",
    });
    const { orderItemId: orderItemB } = await createTestOrderWithItem(admin, {
      product,
      quantity: "1",
    });

    const results = await Promise.allSettled([
      reserveInventory({ orderItemId: orderItemA, variantId, quantity: 1 }),
      reserveInventory({ orderItemId: orderItemB, variantId, quantity: 1 }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const item = await db.inventoryItem.findUniqueOrThrow({
      where: { productVariantId: variantId },
    });
    expect(item.quantityReserved.toNumber()).toBe(1);
    expect(item.quantityAvailable?.toNumber()).toBe(0);

    const reserveMovements = await db.inventoryMovement.count({
      where: { inventoryItemId: item.id, type: "RESERVE" },
    });
    expect(reserveMovements).toBe(1);
  });

  it("[2/7] a reservation racing an adjustment never leaves quantity_reserved > quantity_on_hand", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "10",
    });

    await Promise.allSettled([
      reserveInventory({ orderItemId, variantId, quantity: 10 }),
      adjustInventory(admin, variantId, {
        delta: -10,
        note: "Concurrent stocktake correction",
      }),
    ]);

    const item = await db.inventoryItem.findUniqueOrThrow({
      where: { productVariantId: variantId },
    });
    const isInvalidState = item.quantityReserved.greaterThan(
      item.quantityOnHand,
    );
    expect(isInvalidState).toBe(false);
  });

  it("[3/7] two concurrent releaseInventory calls for the same order item release exactly once", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "6",
    });
    await reserveInventory({ orderItemId, variantId, quantity: 6 });

    const results = await Promise.allSettled([
      releaseInventory({ orderItemId }),
      releaseInventory({ orderItemId }),
    ]);

    // Idempotent by design — a genuinely concurrent duplicate must never
    // surface as a hard error to either caller.
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);
    if (
      fulfilled[0]?.status === "fulfilled" &&
      fulfilled[1]?.status === "fulfilled"
    ) {
      expect(fulfilled[0].value.id).toBe(fulfilled[1].value.id);
    }

    const item = await db.inventoryItem.findUniqueOrThrow({
      where: { productVariantId: variantId },
    });
    expect(item.quantityReserved.toNumber()).toBe(0);
    expect(item.quantityOnHand.toNumber()).toBe(10);

    const releaseMovements = await db.inventoryMovement.count({
      where: { orderItemId, type: "RELEASE" },
    });
    expect(releaseMovements).toBe(1);
  });

  it("[4/7] two concurrent completeInventorySale calls for the same order item sell exactly once", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "6",
    });
    await reserveInventory({ orderItemId, variantId, quantity: 6 });

    const results = await Promise.allSettled([
      completeInventorySale({ orderItemId }),
      completeInventorySale({ orderItemId }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);
    if (
      fulfilled[0]?.status === "fulfilled" &&
      fulfilled[1]?.status === "fulfilled"
    ) {
      expect(fulfilled[0].value.id).toBe(fulfilled[1].value.id);
    }

    const item = await db.inventoryItem.findUniqueOrThrow({
      where: { productVariantId: variantId },
    });
    expect(item.quantityOnHand.toNumber()).toBe(4);
    expect(item.quantityReserved.toNumber()).toBe(0);

    const saleMovements = await db.inventoryMovement.count({
      where: { orderItemId, type: "SALE" },
    });
    expect(saleMovements).toBe(1);
  });

  it("[5/7] a duplicate SALE call made AFTER the first has already committed returns the same movement, not a hard error", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });
    const { orderItemId } = await createTestOrderWithItem(admin, {
      product,
      quantity: "6",
    });
    await reserveInventory({ orderItemId, variantId, quantity: 6 });

    // Sequential, not concurrent — the first call fully commits before
    // the second even starts. This is precisely the case that exposed
    // the idempotency bug found during implementation testing: the
    // guarded UPDATE's own WHERE clause (`quantityReserved >= saleQuantity`)
    // fails unconditionally on a post-commit retry, since the first
    // call's own effect already zeroed `quantityReserved` out — without
    // the fast-path existence check added to fix it, this would
    // surface as a spurious "cannot convert more to a sale than is
    // reserved" error instead of idempotently succeeding.
    const first = await completeInventorySale({ orderItemId });
    const second = await completeInventorySale({ orderItemId });
    expect(second.id).toBe(first.id);

    const item = await db.inventoryItem.findUniqueOrThrow({
      where: { productVariantId: variantId },
    });
    expect(item.quantityOnHand.toNumber()).toBe(4);

    const saleMovements = await db.inventoryMovement.count({
      where: { orderItemId, type: "SALE" },
    });
    expect(saleMovements).toBe(1);
  });

  it(
    "[6/7] retry after a simulated transaction failure (dedup-constraint collision) never double-applies " +
      "the balance change — the losing transaction's guarded UPDATE is fully rolled back, not partially applied",
    async () => {
      const admin = await createSuperAdminActor();
      const product = await createTestProduct(admin);
      const variantId = BigInt(product.variants[0]!.id);
      // Ample stock — both concurrent attempts' guarded UPDATE would
      // independently succeed if run in isolation; the ONLY thing that
      // should prevent double-application is the dedup-key unique
      // constraint forcing one transaction's INSERT (and therefore its
      // whole transaction, including the UPDATE that ran before it) to
      // roll back.
      await restockInventory(admin, variantId, { quantity: 20 });
      const { orderItemId } = await createTestOrderWithItem(admin, {
        product,
        quantity: "5",
      });

      const results = await Promise.allSettled([
        reserveInventory({ orderItemId, variantId, quantity: 5 }),
        reserveInventory({ orderItemId, variantId, quantity: 5 }),
      ]);

      // Both calls resolve successfully (idempotent recovery), never a
      // hard error from either.
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(2);
      if (
        fulfilled[0]?.status === "fulfilled" &&
        fulfilled[1]?.status === "fulfilled"
      ) {
        expect(fulfilled[0].value.id).toBe(fulfilled[1].value.id);
      }

      const item = await db.inventoryItem.findUniqueOrThrow({
        where: { productVariantId: variantId },
      });
      // The critical assertion: reserved must be exactly 5, not 10 — if
      // the losing transaction's UPDATE had NOT been fully rolled back
      // by the failed INSERT, this would read 10 (double-applied).
      expect(item.quantityReserved.toNumber()).toBe(5);
      expect(item.quantityAvailable?.toNumber()).toBe(15);

      const reserveMovements = await db.inventoryMovement.count({
        where: { orderItemId, type: "RESERVE" },
      });
      expect(reserveMovements).toBe(1);
    },
  );

  it("[7/7] two concurrent absolute-target adjustments serialize via SELECT FOR UPDATE — final on-hand is one of the two targets, never corrupted", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });

    const targetA = 25;
    const targetB = 40;

    const results = await Promise.allSettled([
      adjustInventory(admin, variantId, {
        newQuantity: targetA,
        note: "Concurrent stocktake A",
      }),
      adjustInventory(admin, variantId, {
        newQuantity: targetB,
        note: "Concurrent stocktake B",
      }),
    ]);

    // Whichever transaction the FOR UPDATE lock admits second computes
    // its delta from the first's already-committed result, then lands
    // exactly on its own target — so both attempts succeed (neither
    // target equals the other, so neither computes a zero delta),
    // and the final state is deterministically one of the two targets,
    // never a corrupted intermediate value.
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);

    const item = await db.inventoryItem.findUniqueOrThrow({
      where: { productVariantId: variantId },
    });
    expect([targetA, targetB]).toContain(item.quantityOnHand.toNumber());

    const movements = await db.inventoryMovement.findMany({
      where: { inventoryItemId: item.id, type: "ADJUSTMENT" },
    });
    expect(movements).toHaveLength(2);
    const totalDelta = movements.reduce(
      (sum, m) => sum + m.onHandDelta.toNumber(),
      0,
    );
    expect(totalDelta).toBe(item.quantityOnHand.toNumber() - 10);
  });
});
