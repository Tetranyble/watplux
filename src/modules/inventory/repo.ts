import { Prisma } from "@prisma/client";
import type { InventoryItem, InventoryMovement } from "@prisma/client";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { computeAdjustmentDelta } from "@/src/modules/inventory/quantity";

/**
 * Data access layer — the only file in this module allowed to import the
 * Prisma client, per docs/ARCHITECTURE.md §1. Every `$transaction`
 * boundary and the one `SELECT ... FOR UPDATE` lock
 * (docs/PHASE_5_INVENTORY_PLAN.md §7/§12) live here.
 */

type TransactionClient = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Prisma's P2002 error on MySQL reports `meta.target` as a single string
 * (the index name), confirmed empirically against this project's actual
 * database for both a default-named unique column (`inventory_items_product_variant_id_key`)
 * and a custom-mapped one (`uq_one_reserve_release_sale_per_order_item`) —
 * not assumed from Phase 4's catalog findings alone. */
function isUniqueConstraintViolation(error: unknown, hint: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const target = error.meta?.target;
  return typeof target === "string" && target.includes(hint);
}

const ZERO = new Prisma.Decimal(0);

/**
 * `audit_logs` is generic, system-wide infrastructure
 * (docs/DATABASE_DESIGN.md §15) — not owned by the auth domain any more
 * than by this one, even though `src/modules/auth/repo.ts` happened to be
 * the first module to need it (Phase 3). Writing it directly here, inside
 * the SAME transaction as the movement insert, keeps this module's
 * "only repo.ts touches Prisma" boundary intact (no cross-module repo
 * import) and is strictly stronger than Phase 3's own pattern (which
 * wrote its audit log as a separate, non-transactional call after the
 * main write) — here, the movement and its audit entry succeed or fail
 * together. */
async function insertAuditLog(
  tx: TransactionClient,
  data: {
    actorId: bigint;
    action: string;
    entityType: string;
    entityId: bigint;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: data.actorId,
      actorType: "USER",
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
    },
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findInventoryItemByVariantId(
  variantId: bigint,
): Promise<InventoryItem | null> {
  return db.inventoryItem.findUnique({
    where: { productVariantId: variantId },
  });
}

export async function findInventoryItemById(
  id: bigint,
): Promise<InventoryItem | null> {
  return db.inventoryItem.findUnique({ where: { id } });
}

export interface IdCursor {
  id: bigint;
}

export function encodeIdCursor(cursor: IdCursor): string {
  return Buffer.from(cursor.id.toString()).toString("base64url");
}

export function decodeIdCursor(raw: string): IdCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    return { id: BigInt(decoded) };
  } catch {
    return null;
  }
}

export interface ListInventoryFilters {
  lowStockOnly?: boolean;
  cursor?: IdCursor;
  limit: number;
}

/** `quantity_available <= low_stock_threshold` is a genuine column-vs-column
 * comparison Prisma's type-safe query builder cannot express (the same
 * limitation Phase 4 noted for the default-variant invariant) — the
 * `lowStockOnly` path uses `$queryRaw` for exactly this reason, with
 * every value parameterized (never string-concatenated). */
export async function listInventoryItems(
  filters: ListInventoryFilters,
): Promise<{ rows: InventoryItem[]; nextCursor: string | null }> {
  const take = filters.limit + 1;

  // Column aliases below are required, not cosmetic: `$queryRaw` returns
  // exactly the column names the query specifies (snake_case, matching
  // `inventory_items`'s actual DB columns) rather than Prisma's camelCase
  // model field names — confirmed empirically against this project's real
  // database. Without the aliases, callers of this function (e.g.
  // `toInventoryBalance`) would read `undefined` off every camelCase
  // field. Value *types* (Decimal for DECIMAL columns, BigInt for
  // UnsignedBigInt, Date for DATETIME) already come back correctly typed
  // from the driver, so only the keys need remapping here.
  const rows = filters.lowStockOnly
    ? await db.$queryRaw<InventoryItem[]>`
        SELECT
          id,
          product_variant_id AS productVariantId,
          quantity_on_hand AS quantityOnHand,
          quantity_reserved AS quantityReserved,
          quantity_available AS quantityAvailable,
          low_stock_threshold AS lowStockThreshold,
          updated_at AS updatedAt
        FROM inventory_items
        WHERE low_stock_threshold IS NOT NULL
          AND quantity_available <= low_stock_threshold
          ${filters.cursor ? Prisma.sql`AND id > ${filters.cursor.id}` : Prisma.empty}
        ORDER BY id ASC
        LIMIT ${take}
      `
    : await db.inventoryItem.findMany({
        where: filters.cursor ? { id: { gt: filters.cursor.id } } : undefined,
        orderBy: { id: "asc" },
        take,
      });

  const hasNextPage = rows.length > filters.limit;
  const pageRows = hasNextPage ? rows.slice(0, filters.limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasNextPage && lastRow ? encodeIdCursor({ id: lastRow.id }) : null;

  return { rows: pageRows, nextCursor };
}

export interface MovementCursor {
  createdAt: Date;
  id: bigint;
}

export function encodeMovementCursor(cursor: MovementCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString(
    "base64url",
  );
}

export function decodeMovementCursor(raw: string): MovementCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const [isoDate, idString] = decoded.split("|");
    if (!isoDate || !idString) return null;
    const createdAt = new Date(isoDate);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: BigInt(idString) };
  } catch {
    return null;
  }
}

export async function listMovementsForItem(
  inventoryItemId: bigint,
  cursor: MovementCursor | undefined,
  limit: number,
): Promise<{ rows: InventoryMovement[]; nextCursor: string | null }> {
  const rows = await db.inventoryMovement.findMany({
    where: {
      inventoryItemId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasNextPage && lastRow
      ? encodeMovementCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
      : null;

  return { rows: pageRows, nextCursor };
}

// ---------------------------------------------------------------------------
// Restock — creates the InventoryItem row if it doesn't exist yet
// ---------------------------------------------------------------------------

export interface RestockData {
  variantId: bigint;
  quantity: Prisma.Decimal;
  referenceType?: "MANUAL" | "PURCHASE_ORDER";
  referenceId?: bigint;
  note?: string;
  createdBy: bigint;
}

/**
 * `product_variants.inventoryItem` is optional (docs/PHASE_5_INVENTORY_PLAN.md
 * §1) — a variant may have no `InventoryItem` row yet. This function
 * creates it on first-ever restock. Two concurrent first-ever restocks
 * for the same variant race on the existing `productVariantId` unique
 * index (confirmed empirically: MySQL reports
 * `inventory_items_product_variant_id_key`, not a new mechanism this
 * plan introduces) — handled by catching that specific violation and
 * retrying as a plain increment against the now-existing row, rather
 * than leaking a raw Prisma error.
 */
export async function restockInventory(
  data: RestockData,
): Promise<InventoryMovement> {
  return db.$transaction(async (tx) => {
    let inventoryItem = await tx.inventoryItem.findUnique({
      where: { productVariantId: data.variantId },
    });
    let isFirstEverStock = false;

    if (!inventoryItem) {
      try {
        inventoryItem = await tx.inventoryItem.create({
          data: {
            productVariantId: data.variantId,
            quantityOnHand: data.quantity,
          },
        });
        isFirstEverStock = true;
      } catch (error) {
        if (!isUniqueConstraintViolation(error, "product_variant_id")) {
          throw error;
        }
        // Lost the create race to a concurrent first-ever restock — the
        // row now exists; fall through to the increment path below
        // against the row the other transaction just committed.
        inventoryItem = await tx.inventoryItem.findUniqueOrThrow({
          where: { productVariantId: data.variantId },
        });
      }
    }

    if (!isFirstEverStock) {
      await tx.inventoryItem.update({
        where: { id: inventoryItem.id },
        data: { quantityOnHand: { increment: data.quantity } },
      });
    }

    const movement = await insertMovement(tx, {
      inventoryItemId: inventoryItem.id,
      type: "RESTOCK",
      onHandDelta: data.quantity,
      reservedDelta: ZERO,
      referenceType: data.referenceType,
      referenceId: data.referenceId,
      note: data.note,
      createdBy: data.createdBy,
    });

    await insertAuditLog(tx, {
      actorId: data.createdBy,
      action: "inventory.restock",
      entityType: "inventory_item",
      entityId: inventoryItem.id,
    });

    return movement;
  });
}

// ---------------------------------------------------------------------------
// Adjustment — direct delta (blind guarded update) or absolute target
// (the one operation needing SELECT ... FOR UPDATE)
// ---------------------------------------------------------------------------

export interface AdjustByDeltaData {
  variantId: bigint;
  delta: Prisma.Decimal;
  note: string;
  createdBy: bigint;
}

/**
 * Blind guarded relative update — no read needed, the caller already
 * knows the exact signed delta (docs/PHASE_5_INVENTORY_PLAN.md §7). The
 * existence check runs on `db` directly, before the transaction opens —
 * `inventoryItem.id` is immutable so this is safe on its own, and
 * (defense-in-depth, verified empirically to cause no actual bug either
 * way) it also means the transaction's own guarded UPDATE below is
 * unconditionally its first statement, matching `adjustInventoryToTarget`'s
 * same contract and keeping the later "refreshed" invariant check's
 * correctness independent of the "a write forces a current read of the
 * whole row" mechanic it would otherwise quietly rely on.
 */
export async function adjustInventoryByDelta(
  data: AdjustByDeltaData,
): Promise<InventoryMovement> {
  const existingItem = await db.inventoryItem.findUnique({
    where: { productVariantId: data.variantId },
  });
  if (!existingItem) {
    throw new NotFoundError(
      "No inventory is tracked for this product variant yet.",
    );
  }
  const inventoryItem = existingItem;

  return db.$transaction(async (tx) => {
    const result = await tx.inventoryItem.updateMany({
      where: {
        id: inventoryItem.id,
        // Guards both directions in one WHERE: the resulting on-hand
        // must stay >= 0, and must never drop below what's currently
        // reserved (docs/PHASE_5_INVENTORY_PLAN.md §12).
        quantityOnHand: {
          gte: data.delta.isNegative() ? data.delta.abs() : ZERO,
        },
      },
      data: { quantityOnHand: { increment: data.delta } },
    });
    if (result.count === 0) {
      throw new ValidationError(
        "This adjustment would result in a negative on-hand quantity.",
      );
    }

    const refreshed = await tx.inventoryItem.findUniqueOrThrow({
      where: { id: inventoryItem.id },
    });
    if (refreshed.quantityReserved.greaterThan(refreshed.quantityOnHand)) {
      throw new ValidationError(
        "This adjustment would leave reserved quantity greater than on-hand quantity.",
      );
    }

    const movement = await insertMovement(tx, {
      inventoryItemId: inventoryItem.id,
      type: "ADJUSTMENT",
      onHandDelta: data.delta,
      reservedDelta: ZERO,
      note: data.note,
      createdBy: data.createdBy,
    });

    await insertAuditLog(tx, {
      actorId: data.createdBy,
      action: "inventory.adjustment",
      entityType: "inventory_item",
      entityId: inventoryItem.id,
    });

    return movement;
  });
}

export interface AdjustToTargetData {
  variantId: bigint;
  newQuantity: Prisma.Decimal;
  note: string;
  createdBy: bigint;
}

/**
 * The one operation in this domain needing an explicit row lock
 * (docs/PHASE_5_INVENTORY_PLAN.md §7/§12): the delta depends on the
 * *current* value, which must be read before it can be computed. The
 * existence check resolving `inventoryItem.id` runs on `db` directly,
 * before the transaction opens (immutable value, safe outside any
 * transaction — the same fix Phase 4 applied to its own `productId`
 * lookups). That makes the `SELECT ... FOR UPDATE` below unconditionally
 * the transaction's own first statement — no plain read inside the
 * transaction precedes it, which is exactly the ordering that caused
 * Phase 4's snapshot-poisoning bug when violated
 * (docs/PHASE_4_CATALOG_IMPLEMENTATION.md §6).
 */
export async function adjustInventoryToTarget(
  data: AdjustToTargetData,
): Promise<InventoryMovement> {
  const existingItem = await db.inventoryItem.findUnique({
    where: { productVariantId: data.variantId },
  });
  if (!existingItem) {
    throw new NotFoundError(
      "No inventory is tracked for this product variant yet.",
    );
  }
  const inventoryItem = existingItem;

  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { id: bigint; quantity_on_hand: Prisma.Decimal }[]
    >`SELECT id, quantity_on_hand FROM inventory_items WHERE id = ${inventoryItem.id} FOR UPDATE`;
    const lockedRow = locked[0];
    if (!lockedRow) {
      throw new NotFoundError(
        "No inventory is tracked for this product variant yet.",
      );
    }

    const currentOnHand = new Prisma.Decimal(lockedRow.quantity_on_hand);
    const delta = computeAdjustmentDelta(currentOnHand, data.newQuantity);
    if (delta.isZero()) {
      throw new ValidationError(
        "The target quantity is already the current on-hand quantity — nothing to adjust.",
      );
    }

    const result = await tx.inventoryItem.updateMany({
      where: {
        id: inventoryItem.id,
        quantityOnHand: { gte: delta.isNegative() ? delta.abs() : ZERO },
      },
      data: { quantityOnHand: { increment: delta } },
    });
    if (result.count === 0) {
      throw new ValidationError(
        "This adjustment would result in a negative on-hand quantity.",
      );
    }

    const refreshed = await tx.inventoryItem.findUniqueOrThrow({
      where: { id: inventoryItem.id },
    });
    if (refreshed.quantityReserved.greaterThan(refreshed.quantityOnHand)) {
      throw new ValidationError(
        "This adjustment would leave reserved quantity greater than on-hand quantity.",
      );
    }

    const movement = await insertMovement(tx, {
      inventoryItemId: inventoryItem.id,
      type: "ADJUSTMENT",
      onHandDelta: delta,
      reservedDelta: ZERO,
      note: data.note,
      createdBy: data.createdBy,
    });

    await insertAuditLog(tx, {
      actorId: data.createdBy,
      action: "inventory.adjustment",
      entityType: "inventory_item",
      entityId: inventoryItem.id,
    });

    return movement;
  });
}

// ---------------------------------------------------------------------------
// Return
// ---------------------------------------------------------------------------

export interface RecordReturnData {
  variantId: bigint;
  quantity: Prisma.Decimal;
  orderItemId?: bigint;
  note?: string;
  createdBy: bigint;
}

/** Blind guarded increment — a return always adds physical stock back;
 * no dedup constraint (repeats are legitimate, docs/PHASE_5_INVENTORY_PLAN.md
 * §3). */
export async function recordInventoryReturn(
  data: RecordReturnData,
): Promise<InventoryMovement> {
  return db.$transaction(async (tx) => {
    const inventoryItem = await tx.inventoryItem.findUnique({
      where: { productVariantId: data.variantId },
    });
    if (!inventoryItem) {
      throw new NotFoundError(
        "No inventory is tracked for this product variant yet.",
      );
    }

    await tx.inventoryItem.update({
      where: { id: inventoryItem.id },
      data: { quantityOnHand: { increment: data.quantity } },
    });

    return insertMovement(tx, {
      inventoryItemId: inventoryItem.id,
      type: "RETURN",
      onHandDelta: data.quantity,
      reservedDelta: ZERO,
      orderItemId: data.orderItemId,
      note: data.note,
      createdBy: data.createdBy,
    });
  });
}

// ---------------------------------------------------------------------------
// Inter-module contracts — RESERVE / RELEASE / SALE
// ---------------------------------------------------------------------------

/**
 * Verifies the order item exists AND belongs to the exact variant being
 * mutated — the FK on `inventory_movements.order_item_id` only proves the
 * referenced row exists, never that it names the same variant as the
 * inventory item in play (post-approval correction, not part of the
 * originally approved plan — see the implementation report). Runs inside
 * the caller's transaction; throws before any inventory mutation if the
 * association doesn't hold, causing the whole transaction to roll back.
 */
async function requireMatchingOrderItem(
  tx: TransactionClient,
  orderItemId: bigint,
  variantId: bigint,
) {
  const orderItem = await tx.orderItem.findUnique({
    where: { id: orderItemId },
  });
  if (!orderItem) {
    throw new NotFoundError("Order item not found.");
  }
  if (
    orderItem.productVariantId === null ||
    orderItem.productVariantId !== variantId
  ) {
    throw new ValidationError(
      "This order item does not belong to the specified product variant.",
    );
  }
  return orderItem;
}

export interface ReserveInventoryData {
  orderItemId: bigint;
  variantId: bigint;
  quantity: Prisma.Decimal;
}

export async function reserveInventory(
  data: ReserveInventoryData,
): Promise<InventoryMovement> {
  // Idempotency fast path (found during integration testing, not part of
  // the original design — see docs/PHASE_5_INVENTORY_IMPLEMENTATION.md):
  // a SEQUENTIAL duplicate call, made after the first has already
  // committed, must not re-run the guarded UPDATE below — that guard
  // checks `quantityAvailable`, which the first call's own effect already
  // changed, so on retry it can legitimately fail (insufficient stock)
  // even though this is a pure duplicate, not a real second reservation.
  // Checking for an existing movement first (a plain read outside the
  // transaction — RESERVE movements are never mutated once inserted, so
  // this is safe) restores idempotency for that case. A genuinely
  // CONCURRENT duplicate is unaffected: both calls can still race past
  // this check seeing nothing yet, and the dedup-key unique constraint
  // below (caught in the outer catch) remains the actual safety net.
  const existingReserve = await db.inventoryMovement.findFirst({
    where: { orderItemId: data.orderItemId, type: "RESERVE" },
  });
  if (existingReserve) {
    return existingReserve;
  }

  try {
    return await db.$transaction(async (tx) => {
      const orderItem = await requireMatchingOrderItem(
        tx,
        data.orderItemId,
        data.variantId,
      );
      if (!orderItem.quantity.equals(data.quantity)) {
        throw new ValidationError(
          "Requested reservation quantity does not match the order item's committed quantity.",
        );
      }

      const inventoryItem = await tx.inventoryItem.findUnique({
        where: { productVariantId: data.variantId },
      });
      if (!inventoryItem) {
        throw new NotFoundError(
          "No inventory is tracked for this product variant yet.",
        );
      }

      const result = await tx.inventoryItem.updateMany({
        where: {
          id: inventoryItem.id,
          quantityAvailable: { gte: data.quantity },
        },
        data: { quantityReserved: { increment: data.quantity } },
      });
      if (result.count === 0) {
        // Guard failure has two possible causes, and they must not be
        // confused: genuinely insufficient stock, OR a concurrent
        // duplicate call whose sibling transaction ALREADY committed a
        // RESERVE for this exact order item between this transaction's
        // fast-path check (above, before the stock changed) and its own
        // guarded UPDATE (evaluated against the now-changed latest
        // committed data). Deliberately reads via `db`, NOT `tx`: this
        // transaction already did plain reads earlier (orderItem,
        // inventoryItem), fixing its REPEATABLE READ snapshot BEFORE the
        // sibling could have committed — a plain `tx.` read here would
        // be invisible to the sibling's already-committed INSERT (the
        // same snapshot-poisoning class documented on
        // `adjustInventoryToTarget`, but this time genuinely triggered,
        // confirmed empirically via the concurrency test suite). `db.`
        // opens a fresh, separate, unpoisoned read.
        const existingAfterGuardFailure = await db.inventoryMovement.findFirst({
          where: { orderItemId: data.orderItemId, type: "RESERVE" },
        });
        if (existingAfterGuardFailure) {
          return existingAfterGuardFailure;
        }
        throw new ValidationError("Insufficient available stock to reserve.");
      }

      return insertMovement(tx, {
        inventoryItemId: inventoryItem.id,
        type: "RESERVE",
        onHandDelta: ZERO,
        reservedDelta: data.quantity,
        orderItemId: data.orderItemId,
      });
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error, "reserve_release_sale")) {
      return getExistingMovementOrThrow(data.orderItemId, "RESERVE");
    }
    throw error;
  }
}

export interface ReleaseInventoryData {
  orderItemId: bigint;
}

export async function releaseInventory(
  data: ReleaseInventoryData,
): Promise<InventoryMovement> {
  // Idempotency fast path — see the identical comment in `reserveInventory`.
  // For RELEASE this matters even more: the guard below checks
  // `quantityReserved`, which the first call's own effect drives to
  // (or below) the exact quantity being released — so a sequential
  // retry's guard fails UNCONDITIONALLY, every time, not just at a
  // stock-level boundary. Without this check, a duplicate RELEASE call
  // would always surface as a spurious "cannot release more than is
  // reserved" error instead of idempotently succeeding.
  const existingRelease = await db.inventoryMovement.findFirst({
    where: { orderItemId: data.orderItemId, type: "RELEASE" },
  });
  if (existingRelease) {
    return existingRelease;
  }

  try {
    return await db.$transaction(async (tx) => {
      const orderItem = await tx.orderItem.findUnique({
        where: { id: data.orderItemId },
      });
      if (!orderItem) {
        throw new NotFoundError("Order item not found.");
      }
      if (orderItem.productVariantId === null) {
        throw new ValidationError(
          "This order item has no associated product variant.",
        );
      }

      const inventoryItem = await tx.inventoryItem.findUnique({
        where: { productVariantId: orderItem.productVariantId },
      });
      if (!inventoryItem) {
        throw new NotFoundError(
          "No inventory is tracked for this product variant.",
        );
      }

      const reserveMovement = await tx.inventoryMovement.findFirst({
        where: { orderItemId: data.orderItemId, type: "RESERVE" },
      });
      if (!reserveMovement) {
        throw new ValidationError("No reservation exists for this order item.");
      }
      // Defense-in-depth: the RESERVE this release undoes must belong to
      // the same inventory item we're about to mutate — should always be
      // true given orderItem.productVariantId is immutable, but verified
      // directly rather than assumed.
      if (reserveMovement.inventoryItemId !== inventoryItem.id) {
        throw new ValidationError(
          "The existing reservation for this order item does not match the resolved inventory item.",
        );
      }

      const releaseQuantity = reserveMovement.reservedDelta;

      const result = await tx.inventoryItem.updateMany({
        where: {
          id: inventoryItem.id,
          quantityReserved: { gte: releaseQuantity },
        },
        data: { quantityReserved: { decrement: releaseQuantity } },
      });
      if (result.count === 0) {
        // See the identical comment in `reserveInventory` — for RELEASE
        // this branch is reached far more often, because a genuinely
        // CONCURRENT duplicate's guard fails UNCONDITIONALLY once the
        // sibling transaction commits (it decrements `quantityReserved`
        // by exactly this same amount), never reaching the dedup-key
        // INSERT that the outer catch below relies on. Reads via `db`,
        // not `tx` — this transaction's earlier plain reads already
        // fixed its snapshot before the sibling could have committed.
        const existingAfterGuardFailure = await db.inventoryMovement.findFirst({
          where: { orderItemId: data.orderItemId, type: "RELEASE" },
        });
        if (existingAfterGuardFailure) {
          return existingAfterGuardFailure;
        }
        throw new ValidationError(
          "Cannot release more than is currently reserved for this variant.",
        );
      }

      return insertMovement(tx, {
        inventoryItemId: inventoryItem.id,
        type: "RELEASE",
        onHandDelta: ZERO,
        reservedDelta: releaseQuantity.negated(),
        orderItemId: data.orderItemId,
      });
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error, "reserve_release_sale")) {
      return getExistingMovementOrThrow(data.orderItemId, "RELEASE");
    }
    throw error;
  }
}

export interface CompleteInventorySaleData {
  orderItemId: bigint;
}

export async function completeInventorySale(
  data: CompleteInventorySaleData,
): Promise<InventoryMovement> {
  // Idempotency fast path — see the identical comment in
  // `reserveInventory`/`releaseInventory`. The guard below checks
  // `quantityReserved`, which the first call's own effect drives down by
  // exactly the quantity being sold, so a sequential retry's guard fails
  // unconditionally without this check.
  const existingSale = await db.inventoryMovement.findFirst({
    where: { orderItemId: data.orderItemId, type: "SALE" },
  });
  if (existingSale) {
    return existingSale;
  }

  try {
    return await db.$transaction(async (tx) => {
      const orderItem = await tx.orderItem.findUnique({
        where: { id: data.orderItemId },
      });
      if (!orderItem) {
        throw new NotFoundError("Order item not found.");
      }
      if (orderItem.productVariantId === null) {
        throw new ValidationError(
          "This order item has no associated product variant.",
        );
      }

      const inventoryItem = await tx.inventoryItem.findUnique({
        where: { productVariantId: orderItem.productVariantId },
      });
      if (!inventoryItem) {
        throw new NotFoundError(
          "No inventory is tracked for this product variant.",
        );
      }

      const reserveMovement = await tx.inventoryMovement.findFirst({
        where: { orderItemId: data.orderItemId, type: "RESERVE" },
      });
      if (!reserveMovement) {
        throw new ValidationError("No reservation exists for this order item.");
      }
      if (reserveMovement.inventoryItemId !== inventoryItem.id) {
        throw new ValidationError(
          "The existing reservation for this order item does not match the resolved inventory item.",
        );
      }

      const saleQuantity = reserveMovement.reservedDelta;

      const result = await tx.inventoryItem.updateMany({
        where: {
          id: inventoryItem.id,
          quantityReserved: { gte: saleQuantity },
        },
        data: {
          quantityOnHand: { decrement: saleQuantity },
          quantityReserved: { decrement: saleQuantity },
        },
      });
      if (result.count === 0) {
        // See the identical comment in `reserveInventory`/`releaseInventory`
        // — reads via `db`, not `tx`, for the same snapshot-poisoning
        // reason.
        const existingAfterGuardFailure = await db.inventoryMovement.findFirst({
          where: { orderItemId: data.orderItemId, type: "SALE" },
        });
        if (existingAfterGuardFailure) {
          return existingAfterGuardFailure;
        }
        throw new ValidationError(
          "Cannot convert more to a sale than is currently reserved for this variant.",
        );
      }

      return insertMovement(tx, {
        inventoryItemId: inventoryItem.id,
        type: "SALE",
        onHandDelta: saleQuantity.negated(),
        reservedDelta: saleQuantity.negated(),
        orderItemId: data.orderItemId,
      });
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error, "reserve_release_sale")) {
      return getExistingMovementOrThrow(data.orderItemId, "SALE");
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Transaction-composition primitives (Phase 6 addition, additive only —
// docs/PHASE_6_ORDER_PLAN.md §7). Everything above this line is unchanged
// Phase 5 code: same exports, same signatures, same behavior. These three
// functions exist so a caller that already owns an open transaction (e.g.
// Order's own repo.ts) can compose an inventory mutation into it, instead
// of the standalone functions above each opening their own separate
// transaction — the two would otherwise not commit/roll back together.
// Never imported outside a repo.ts file: the `Prisma.TransactionClient`
// parameter never crosses into a use-case, domain, or presentation module.
// ---------------------------------------------------------------------------

/**
 * Order-creation-only variant of `reserveInventory`, composed into the
 * caller's own transaction instead of opening its own. Deliberately has
 * NO idempotency fast-path or guard-failure recheck: it is only ever
 * called with a just-inserted, never-before-used `orderItemId` (order
 * creation always creates fresh `order_items` rows), so the dedup-key
 * collision `reserveInventory`'s idempotency machinery exists to recover
 * from cannot occur here — a brand-new order_item id has never had a
 * RESERVE movement before. A guard failure here always means genuinely
 * insufficient stock, never a duplicate call.
 */
export async function reserveInventoryForNewOrderItem(
  tx: TransactionClient,
  data: ReserveInventoryData,
): Promise<InventoryMovement> {
  const orderItem = await requireMatchingOrderItem(
    tx,
    data.orderItemId,
    data.variantId,
  );
  if (!orderItem.quantity.equals(data.quantity)) {
    throw new ValidationError(
      "Requested reservation quantity does not match the order item's committed quantity.",
    );
  }

  const inventoryItem = await tx.inventoryItem.findUnique({
    where: { productVariantId: data.variantId },
  });
  if (!inventoryItem) {
    throw new NotFoundError(
      "No inventory is tracked for this product variant yet.",
    );
  }

  const result = await tx.inventoryItem.updateMany({
    where: {
      id: inventoryItem.id,
      quantityAvailable: { gte: data.quantity },
    },
    data: { quantityReserved: { increment: data.quantity } },
  });
  if (result.count === 0) {
    throw new ValidationError("Insufficient available stock to reserve.");
  }

  return insertMovement(tx, {
    inventoryItemId: inventoryItem.id,
    type: "RESERVE",
    onHandDelta: ZERO,
    reservedDelta: data.quantity,
    orderItemId: data.orderItemId,
  });
}

/**
 * Cancellation-composition variant of `releaseInventory`. Idempotent via
 * an explicit pre-check — never via catching a constraint violation
 * mid-way through an already-open, externally owned transaction (untested
 * territory in this codebase; deliberately not relied on). A genuinely
 * concurrent duplicate call for the same order item cannot reach this
 * function twice in practice: the caller (Order's `cancelOrder`) only
 * calls it after winning its own conditional
 * `UPDATE orders SET status = 'CANCELLED' WHERE status = 'PENDING_PAYMENT'`
 * — the loser of that race never reaches this function at all, so no
 * second guard-failure recheck is needed here the way the standalone
 * `releaseInventory` needs one.
 */
export async function releaseInventoryInTransaction(
  tx: TransactionClient,
  data: ReleaseInventoryData,
): Promise<InventoryMovement> {
  // Reads via `db`, not `tx` — the caller's transaction (Order's) may
  // already have performed other plain reads before reaching this call,
  // fixing its REPEATABLE READ snapshot before any sibling could have
  // committed. A fresh `db` read is not subject to that snapshot.
  const existingRelease = await db.inventoryMovement.findFirst({
    where: { orderItemId: data.orderItemId, type: "RELEASE" },
  });
  if (existingRelease) {
    return existingRelease;
  }

  const orderItem = await tx.orderItem.findUnique({
    where: { id: data.orderItemId },
  });
  if (!orderItem) {
    throw new NotFoundError("Order item not found.");
  }
  if (orderItem.productVariantId === null) {
    throw new ValidationError(
      "This order item has no associated product variant.",
    );
  }

  const inventoryItem = await tx.inventoryItem.findUnique({
    where: { productVariantId: orderItem.productVariantId },
  });
  if (!inventoryItem) {
    throw new NotFoundError(
      "No inventory is tracked for this product variant.",
    );
  }

  const reserveMovement = await tx.inventoryMovement.findFirst({
    where: { orderItemId: data.orderItemId, type: "RESERVE" },
  });
  if (!reserveMovement) {
    throw new ValidationError("No reservation exists for this order item.");
  }
  if (reserveMovement.inventoryItemId !== inventoryItem.id) {
    throw new ValidationError(
      "The existing reservation for this order item does not match the resolved inventory item.",
    );
  }

  const releaseQuantity = reserveMovement.reservedDelta;

  const result = await tx.inventoryItem.updateMany({
    where: {
      id: inventoryItem.id,
      quantityReserved: { gte: releaseQuantity },
    },
    data: { quantityReserved: { decrement: releaseQuantity } },
  });
  if (result.count === 0) {
    throw new ValidationError(
      "Cannot release more than is currently reserved for this variant.",
    );
  }

  return insertMovement(tx, {
    inventoryItemId: inventoryItem.id,
    type: "RELEASE",
    onHandDelta: ZERO,
    reservedDelta: releaseQuantity.negated(),
    orderItemId: data.orderItemId,
  });
}

/**
 * Payment-success-composition variant of `completeInventorySale`. Same
 * idempotency reasoning as `releaseInventoryInTransaction`: the caller
 * (`markOrderPaid`) only calls this after winning its own conditional
 * `UPDATE orders SET status = 'PAID' WHERE status = 'PENDING_PAYMENT'`,
 * so a genuinely concurrent duplicate cannot reach this function twice.
 */
export async function completeSaleInTransaction(
  tx: TransactionClient,
  data: CompleteInventorySaleData,
): Promise<InventoryMovement> {
  const existingSale = await db.inventoryMovement.findFirst({
    where: { orderItemId: data.orderItemId, type: "SALE" },
  });
  if (existingSale) {
    return existingSale;
  }

  const orderItem = await tx.orderItem.findUnique({
    where: { id: data.orderItemId },
  });
  if (!orderItem) {
    throw new NotFoundError("Order item not found.");
  }
  if (orderItem.productVariantId === null) {
    throw new ValidationError(
      "This order item has no associated product variant.",
    );
  }

  const inventoryItem = await tx.inventoryItem.findUnique({
    where: { productVariantId: orderItem.productVariantId },
  });
  if (!inventoryItem) {
    throw new NotFoundError(
      "No inventory is tracked for this product variant.",
    );
  }

  const reserveMovement = await tx.inventoryMovement.findFirst({
    where: { orderItemId: data.orderItemId, type: "RESERVE" },
  });
  if (!reserveMovement) {
    throw new ValidationError("No reservation exists for this order item.");
  }
  if (reserveMovement.inventoryItemId !== inventoryItem.id) {
    throw new ValidationError(
      "The existing reservation for this order item does not match the resolved inventory item.",
    );
  }

  const saleQuantity = reserveMovement.reservedDelta;

  const result = await tx.inventoryItem.updateMany({
    where: {
      id: inventoryItem.id,
      quantityReserved: { gte: saleQuantity },
    },
    data: {
      quantityOnHand: { decrement: saleQuantity },
      quantityReserved: { decrement: saleQuantity },
    },
  });
  if (result.count === 0) {
    throw new ValidationError(
      "Cannot convert more to a sale than is currently reserved for this variant.",
    );
  }

  return insertMovement(tx, {
    inventoryItemId: inventoryItem.id,
    type: "SALE",
    onHandDelta: saleQuantity.negated(),
    reservedDelta: saleQuantity.negated(),
    orderItemId: data.orderItemId,
  });
}

/** Called after catching the dedup-key violation — the transaction that
 * hit it has already fully rolled back (including any balance change
 * that ran before the failed insert), so this is a fresh, separate read
 * returning the pre-existing movement as the idempotent result
 * (docs/PHASE_5_INVENTORY_PLAN.md §7/§14). */
async function getExistingMovementOrThrow(
  orderItemId: bigint,
  type: "RESERVE" | "RELEASE" | "SALE",
): Promise<InventoryMovement> {
  const existing = await db.inventoryMovement.findFirst({
    where: { orderItemId, type },
  });
  if (!existing) {
    // The dedup key fired but no matching row is found — should be
    // unreachable; surfaced as a generic error rather than silently
    // swallowed.
    throw new ConflictError(
      `A duplicate ${type} was detected for this order item, but the existing movement could not be found.`,
    );
  }
  return existing;
}

// ---------------------------------------------------------------------------
// Shared movement insert
// ---------------------------------------------------------------------------

interface InsertMovementData {
  inventoryItemId: bigint;
  type: "RESTOCK" | "RESERVE" | "RELEASE" | "SALE" | "RETURN" | "ADJUSTMENT";
  onHandDelta: Prisma.Decimal;
  reservedDelta: Prisma.Decimal;
  orderItemId?: bigint;
  referenceType?: "MANUAL" | "PURCHASE_ORDER";
  referenceId?: bigint;
  note?: string;
  createdBy?: bigint;
}

async function insertMovement(
  tx: TransactionClient,
  data: InsertMovementData,
): Promise<InventoryMovement> {
  return tx.inventoryMovement.create({
    data: {
      inventoryItemId: data.inventoryItemId,
      type: data.type,
      onHandDelta: data.onHandDelta,
      reservedDelta: data.reservedDelta,
      orderItemId: data.orderItemId,
      referenceType: data.referenceType,
      referenceId: data.referenceId,
      note: data.note,
      createdBy: data.createdBy,
    },
  });
}

// ---------------------------------------------------------------------------
// Admin dashboard metrics (docs/PHASE_10_ADMIN_PLAN.md §9) — read-only.
// ---------------------------------------------------------------------------

/** A `COUNT(*)` mirror of `listInventoryItems`'s own `lowStockOnly` raw
 * query — same column-vs-column comparison Prisma's query builder can't
 * express, same reasoning, just a count instead of a page of rows. */
export async function countLowStockItems(): Promise<number> {
  const rows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count
    FROM inventory_items
    WHERE low_stock_threshold IS NOT NULL
      AND quantity_available <= low_stock_threshold
  `;
  return Number(rows[0]?.count ?? BigInt(0));
}
