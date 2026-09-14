import { Prisma } from "@prisma/client";
import type { Cart, CartItem, Product, ProductVariant } from "@prisma/client";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { GUEST_CART_TTL_DAYS } from "@/src/modules/cart/constants";
import { computeMergedCartLines } from "@/src/modules/cart/merge";
import type { CartOwner } from "@/src/modules/cart/types";

/**
 * Data access layer — the only file in this module allowed to import the
 * Prisma client, per docs/ARCHITECTURE.md §1. Every `$transaction`
 * boundary and every `SELECT ... FOR UPDATE` lock
 * (docs/PHASE_7_CART_CHECKOUT_PLAN.md §11) live here.
 *
 * Reads `product_variants`/`products` directly (Catalog domain tables) to
 * resolve display/checkout data — mirrors Order's own established
 * precedent (`src/modules/order/repo.ts`'s `resolveOrderLine`) of reading
 * another module's tables directly from `repo.ts`: the "only repo.ts
 * touches Prisma" rule is about *which layer* may use the Prisma client,
 * not about which module "owns" which table exclusively.
 */

type TransactionClient = Prisma.TransactionClient;

const CART_ITEM_WITH_VARIANT_INCLUDE = {
  productVariant: { include: { product: true } },
} satisfies Prisma.CartItemInclude;

export type CartItemWithVariant = CartItem & {
  productVariant: ProductVariant & { product: Product };
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Prisma's P2002 error on MySQL reports `meta.target` as a single string
 * (the index name) — confirmed empirically for this exact class of
 * generated-column unique index by Phase 5/6 (`src/modules/inventory/repo.ts`).
 * Small, deliberate duplication of that helper — kept local to this
 * module rather than cross-imported, matching the established
 * per-module-independence precedent. */
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

function ownerActiveWhere(owner: CartOwner): Prisma.CartWhereInput {
  return owner.type === "user"
    ? { userId: owner.userId, status: "ACTIVE" }
    : { guestTokenHash: owner.guestTokenHash, status: "ACTIVE" };
}

function ownerCreateData(owner: CartOwner): Prisma.CartCreateInput {
  if (owner.type === "user") {
    return { user: { connect: { id: owner.userId } } };
  }
  return {
    guestTokenHash: owner.guestTokenHash,
    expiresAt: new Date(Date.now() + GUEST_CART_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
}

/** Substring hint for `isUniqueConstraintViolation` — must be an actual
 * contiguous substring of the real constraint names
 * (`uq_one_active_cart_per_user`/`uq_one_active_cart_per_guest_token`).
 * A bare `"active_cart_user"`/`"active_cart_guest"` is NOT a substring of
 * either (both names have `_per_` between "cart" and "user"/"guest") —
 * found via the mandatory concurrency test suite, not by inspection: a
 * hint that never matches silently defeats the entire "insert, or
 * recover from the concurrent creator's duplicate key" mechanism,
 * letting the real P2002 propagate uncaught instead of being recovered
 * from. */
function ownerUniqueIndexHint(owner: CartOwner): string {
  return owner.type === "user"
    ? "active_cart_per_user"
    : "active_cart_per_guest";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Plan §23 — a single, bounded, non-N+1 query; `null` is a normal state
 * ("no cart yet"), never an error. */
export async function findActiveCartWithItems(
  owner: CartOwner,
): Promise<{ cart: Cart; items: CartItemWithVariant[] } | null> {
  const cart = await db.cart.findFirst({
    where: ownerActiveWhere(owner),
    include: { items: { include: CART_ITEM_WITH_VARIANT_INCLUDE } },
  });
  if (!cart) return null;
  const { items, ...cartRow } = cart;
  return { cart: cartRow, items };
}

/** Lightweight count-only read for a header/badge UI (plan §23) — the
 * number of distinct line items, not total units (a cart can mix
 * `EACH`/`METER` variants, for which a summed-quantity badge would be a
 * meaningless fractional number). `0` for "no active cart" — same
 * "absence is a normal state" convention as `getAvailableQuantity`. */
export async function countActiveCartItems(owner: CartOwner): Promise<number> {
  return db.cartItem.count({ where: { cart: ownerActiveWhere(owner) } });
}

/** Plan §5 step 2 — "does this hash resolve to a real (any-status) cart."
 * Deliberately NOT scoped to `status: 'ACTIVE'`: a guest cookie whose
 * cart has already been `CONVERTED` (e.g. by an earlier merge) still
 * resolves to a real row, but `resolveCartActor()` treats a non-`ACTIVE`
 * result the same as "no cart" for identity purposes (there is nothing
 * further to do with an already-converted guest cart). */
export async function guestTokenHashResolvesToCart(
  hash: string,
): Promise<boolean> {
  const cart = await db.cart.findFirst({
    where: { guestTokenHash: hash },
    select: { id: true },
  });
  return cart !== null;
}

/** Plan §7/§20 — a plain, pre-transaction read (mirrors
 * `order/repo.ts`'s `resolveOrderLine`): nothing later re-reads variant
 * data, so no lock is needed here. */
export async function resolveVariantForCart(
  variantId: bigint,
): Promise<{ priceMinor: number; status: "ACTIVE" | "ARCHIVED" } | null> {
  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    select: { priceMinor: true, status: true },
  });
  return variant;
}

export async function findCartItemById(
  cartItemId: bigint,
): Promise<CartItem | null> {
  return db.cartItem.findUnique({ where: { id: cartItemId } });
}

// ---------------------------------------------------------------------------
// Cart id resolution — lazy creation with the concurrent-creation race
// already specified (plan §1, quoting docs/DATABASE_DESIGN.md §22)
// ---------------------------------------------------------------------------

/**
 * Resolves the caller's `ACTIVE` cart id, creating one if none exists yet
 * (plan §5 — "a cart is only created lazily, on the first mutating
 * call"). Runs entirely via `db`, never inside a mutation's own
 * transaction: this is the exact "insert, or fetch the row someone else
 * just inserted" pattern `docs/DATABASE_DESIGN.md` §22 prescribes for the
 * concurrent-cart-creation race, resolved independently of (and before)
 * whatever mutation the caller performs next — mirrors
 * `inventory/repo.ts`'s `restockInventory`'s identical create-or-recover
 * shape, and keeps the mutation's own `SELECT ... FOR UPDATE` (below)
 * genuinely its transaction's first statement.
 */
export async function getOrCreateActiveCartId(
  owner: CartOwner,
): Promise<bigint> {
  const existing = await db.cart.findFirst({
    where: ownerActiveWhere(owner),
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const created = await db.cart.create({ data: ownerCreateData(owner) });
    return created.id;
  } catch (error) {
    if (!isUniqueConstraintViolation(error, ownerUniqueIndexHint(owner))) {
      throw error;
    }
    // Lost the create race — the row now exists; fetch it.
    const raceWinner = await db.cart.findFirst({
      where: ownerActiveWhere(owner),
      select: { id: true },
    });
    if (!raceWinner) {
      // Unreachable in practice: the unique-constraint violation proves a
      // row exists. Surfaced rather than silently swallowed.
      throw new ConflictError(
        "A concurrent cart-creation conflict could not be resolved.",
      );
    }
    return raceWinner.id;
  }
}

/** Strict variant for mutations that must NOT lazily create a cart (plan
 * §24 — updating/removing/clearing a nonexistent cart is a `NotFoundError`,
 * never a fresh empty cart materializing out of a mutation that isn't
 * "add"). */
export async function findActiveCartId(
  owner: CartOwner,
): Promise<bigint | null> {
  const cart = await db.cart.findFirst({
    where: ownerActiveWhere(owner),
    select: { id: true },
  });
  return cart?.id ?? null;
}

// ---------------------------------------------------------------------------
// Cart-row lock — the single, uniform concurrency primitive (plan §11)
// ---------------------------------------------------------------------------

/**
 * `SELECT id FROM carts WHERE id = ? AND status = 'ACTIVE' FOR UPDATE` as
 * the literal first statement of the caller's transaction — before any
 * plain read of `cart_items` (plan §11). Throws `ConflictError` if the
 * cart is no longer `ACTIVE` (already converted/abandoned by a
 * concurrent operation) — never `NotFoundError` here: an internally
 * resolved cart id that fails to lock means "state changed underneath
 * us," not "never existed" (a genuinely nonexistent id is rejected by the
 * use-case layer's own ownership check before reaching this function at
 * all, plan §24/§27).
 */
async function lockActiveCartOrThrow(
  tx: TransactionClient,
  cartId: bigint,
): Promise<void> {
  const locked = await tx.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM carts WHERE id = ${cartId} AND status = 'ACTIVE' FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new ConflictError("This cart is no longer active.");
  }
}

// ---------------------------------------------------------------------------
// Mutations — each owns its own short transaction, cart-row lock first
// ---------------------------------------------------------------------------

export interface AddOrIncrementCartItemData {
  productVariantId: bigint;
  quantity: Prisma.Decimal;
  priceSnapshotMinor: number;
}

/**
 * Atomic upsert/increment (plan §12) — never check-then-insert.
 * `uq_cart_items_cart_variant` remains the final defense; the cart-row
 * lock above is the primary serialization mechanism.
 */
export async function addOrIncrementCartItem(
  cartId: bigint,
  data: AddOrIncrementCartItemData,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockActiveCartOrThrow(tx, cartId);
    await tx.cartItem.upsert({
      where: {
        cartId_productVariantId: {
          cartId,
          productVariantId: data.productVariantId,
        },
      },
      create: {
        cartId,
        productVariantId: data.productVariantId,
        quantity: data.quantity,
        priceSnapshotMinor: data.priceSnapshotMinor,
      },
      update: {
        quantity: { increment: data.quantity },
        priceSnapshotMinor: data.priceSnapshotMinor,
      },
    });
  });
}

export interface UpdateCartItemQuantityData {
  quantity: Prisma.Decimal;
  priceSnapshotMinor: number;
}

/**
 * Compound `WHERE id = ? AND cartId = ?` doubles as the IDOR guard and
 * the "does this item actually belong to this cart" check in one atomic
 * statement (plan §24/§27) — no separate check-then-act.
 */
export async function updateCartItemQuantity(
  cartId: bigint,
  cartItemId: bigint,
  data: UpdateCartItemQuantityData,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockActiveCartOrThrow(tx, cartId);
    const result = await tx.cartItem.updateMany({
      where: { id: cartItemId, cartId },
      data: {
        quantity: data.quantity,
        priceSnapshotMinor: data.priceSnapshotMinor,
      },
    });
    if (result.count === 0) {
      throw new NotFoundError("Cart item not found.");
    }
  });
}

export async function removeCartItem(
  cartId: bigint,
  cartItemId: bigint,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockActiveCartOrThrow(tx, cartId);
    const result = await tx.cartItem.deleteMany({
      where: { id: cartItemId, cartId },
    });
    if (result.count === 0) {
      throw new NotFoundError("Cart item not found.");
    }
  });
}

export async function clearCart(cartId: bigint): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockActiveCartOrThrow(tx, cartId);
    await tx.cartItem.deleteMany({ where: { cartId } });
  });
}

// ---------------------------------------------------------------------------
// Guest <-> authenticated merge (plan §6) — its own transaction, two
// cart-row locks in deterministic ascending-id order to prevent deadlock
// ---------------------------------------------------------------------------

export interface MergeGuestCartResult {
  merged: boolean;
}

/**
 * Deterministic union-by-variant merge (plan §6): quantities summed,
 * inactive/archived guest variants dropped, guest cart marked
 * `CONVERTED`. A no-op (`{ merged: false }`) if no guest cart exists, or
 * it is no longer `ACTIVE` by the time this transaction's locks are
 * acquired (already merged/converted by a racing call — idempotent,
 * never throws for that case).
 *
 * Lock ordering: the transaction's OWN plain read (resolving/creating the
 * user's cart id) intentionally happens before the two `FOR UPDATE`
 * locks — this is safe despite the general "lock first" rule because
 * `SELECT ... FOR UPDATE` and the guarded `UPDATE` below always read the
 * latest committed row regardless of the transaction's REPEATABLE READ
 * snapshot (InnoDB locking reads bypass the consistent-read view); only
 * the *subsequent plain* reads in this function (the guest-cart
 * re-check, the item list) would be at risk, and both occur strictly
 * after both locks are held.
 */
export async function mergeGuestCartIntoUserCart(
  userId: bigint,
  guestTokenHash: string,
): Promise<MergeGuestCartResult> {
  const guestCart = await db.cart.findFirst({
    where: { guestTokenHash, status: "ACTIVE" },
    select: { id: true },
  });
  if (!guestCart) {
    return { merged: false };
  }

  const existingUserCart = await db.cart.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { id: true },
  });

  return db.$transaction(async (tx) => {
    let userCartId: bigint;
    if (existingUserCart) {
      userCartId = existingUserCart.id;
    } else {
      try {
        const created = await tx.cart.create({ data: { userId } });
        userCartId = created.id;
      } catch (error) {
        if (!isUniqueConstraintViolation(error, "active_cart_per_user")) {
          throw error;
        }
        // Lost the create race — reads via `db`, not `tx`: this is a
        // plain read BEFORE this transaction's own locking statements
        // below, so using `tx` here would fix this transaction's
        // REPEATABLE READ snapshot prematurely (the exact
        // snapshot-poisoning shape Phase 4 already found) and poison
        // every later `tx` read in this function, including the
        // guest-cart re-check just below.
        const raceWinner = await db.cart.findFirst({
          where: { userId, status: "ACTIVE" },
          select: { id: true },
        });
        if (!raceWinner) {
          throw new ConflictError(
            "A concurrent cart-creation conflict could not be resolved during merge.",
          );
        }
        userCartId = raceWinner.id;
      }
    }

    // Deterministic ascending-id lock order — mandatory to avoid deadlock
    // against a concurrent operation locking the same two rows in the
    // opposite order (plan §6/§11).
    const idsAscending = [guestCart.id, userCartId].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const id of idsAscending) {
      await tx.$queryRaw`SELECT id FROM carts WHERE id = ${id} FOR UPDATE`;
    }

    // Reads via `db`, not `tx` — belt-and-suspenders against any
    // ambiguity in exactly when this transaction's REPEATABLE READ
    // snapshot gets pinned relative to the locking statements above
    // (found via the mandatory concurrency test suite: a `tx` read here
    // intermittently missed a concurrently-committed conversion). Safe
    // regardless: this transaction already holds both rows' locks, so no
    // other transaction can be mid-write on either right now, and any
    // state already committed before that lock was acquired is durable.
    const freshGuestCart = await db.cart.findUnique({
      where: { id: guestCart.id },
    });
    if (!freshGuestCart || freshGuestCart.status !== "ACTIVE") {
      // Already merged/converted concurrently (e.g. a double-submitted
      // login) — idempotent no-op, not an error (plan §6).
      return { merged: false };
    }

    // Both reads below happen strictly after both locks are held — safe
    // plain reads, not subject to the snapshot-poisoning concern.
    const [userItems, guestItems] = await Promise.all([
      tx.cartItem.findMany({ where: { cartId: userCartId } }),
      tx.cartItem.findMany({ where: { cartId: guestCart.id } }),
    ]);

    // Resolve current variant status/price for every guest-side variant
    // only (plan §6/§7) — user-only lines are left untouched entirely,
    // never re-priced or re-upserted by a merge that doesn't concern them.
    const guestVariantInfo = new Map<
      string,
      { status: "ACTIVE" | "ARCHIVED"; priceMinor: number }
    >();
    for (const item of guestItems) {
      const variant = await tx.productVariant.findUnique({
        where: { id: item.productVariantId },
        select: { status: true, priceMinor: true },
      });
      if (variant) {
        guestVariantInfo.set(item.productVariantId.toString(), variant);
      }
    }

    // The pure merge decision (docs/PHASE_7_CART_CHECKOUT_PLAN.md §6,
    // unit-tested exhaustively in isolation from any database) — computes
    // the FINAL absolute quantity per variant, so the write below sets an
    // exact value rather than relying on `{ increment }` (which would
    // double-add if this function were ever, even hypothetically,
    // invoked twice for the same pairing).
    const mergedLines = computeMergedCartLines(
      userItems,
      guestItems.map((item) => ({
        productVariantId: item.productVariantId,
        quantity: item.quantity,
        isVariantActive:
          guestVariantInfo.get(item.productVariantId.toString())?.status ===
          "ACTIVE",
      })),
    );

    const guestVariantIds = new Set(
      guestItems.map((item) => item.productVariantId.toString()),
    );
    for (const line of mergedLines) {
      // Only write lines this merge actually touches (present in the
      // guest cart) — a user-only pre-existing line has nothing to merge
      // and is left exactly as it was.
      if (!guestVariantIds.has(line.productVariantId.toString())) continue;
      const variant = guestVariantInfo.get(line.productVariantId.toString());
      if (!variant) continue;

      await tx.cartItem.upsert({
        where: {
          cartId_productVariantId: {
            cartId: userCartId,
            productVariantId: line.productVariantId,
          },
        },
        create: {
          cartId: userCartId,
          productVariantId: line.productVariantId,
          quantity: line.quantity,
          priceSnapshotMinor: variant.priceMinor,
        },
        update: {
          quantity: line.quantity,
          priceSnapshotMinor: variant.priceMinor,
        },
      });
    }

    await tx.cart.updateMany({
      where: { id: guestCart.id, status: "ACTIVE" },
      data: { status: "CONVERTED" },
    });

    return { merged: true };
  });
}

// ---------------------------------------------------------------------------
// Transaction-composition primitives (Phase 7 addition, additive only —
// docs/PHASE_7_CART_CHECKOUT_PLAN.md §14/§17). Never imported outside a
// repo.ts file: the `Prisma.TransactionClient` parameter never crosses
// into a use-case, domain, or presentation module. Composed into
// Checkout's own outer transaction (`src/modules/checkout/repo.ts`),
// exactly mirroring Phase 6's Order<->Inventory "Option A" pattern one
// level higher.
// ---------------------------------------------------------------------------

export interface LockedActiveCart {
  cart: Cart;
  items: CartItemWithVariant[];
}

/**
 * Locks the cart row (the checkout transaction's own first statement,
 * plan §16), verifies ownership and `ACTIVE` status, and returns its
 * items — all in one call, so nothing in Checkout's own transaction
 * performs a plain read before this lock.
 */
export async function lockOwnedActiveCartInTransaction(
  tx: TransactionClient,
  cartId: bigint,
  owner: CartOwner,
): Promise<LockedActiveCart> {
  const locked = await tx.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM carts WHERE id = ${cartId} FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new NotFoundError("Cart not found.");
  }

  const cart = await tx.cart.findUniqueOrThrow({ where: { id: cartId } });

  const isOwner =
    owner.type === "user"
      ? cart.userId !== null && cart.userId === owner.userId
      : cart.guestTokenHash !== null &&
        cart.guestTokenHash === owner.guestTokenHash;
  if (!isOwner) {
    throw new NotFoundError("Cart not found.");
  }
  if (cart.status !== "ACTIVE") {
    throw new ConflictError("This cart has already been checked out.");
  }

  const items = await tx.cartItem.findMany({
    where: { cartId },
    include: CART_ITEM_WITH_VARIANT_INCLUDE,
  });
  if (items.length === 0) {
    throw new ValidationError("Cart is empty.");
  }

  return { cart, items };
}

/**
 * The guarded `ACTIVE -> CONVERTED` transition — Checkout's entire
 * idempotency mechanism (plan §15). By construction this is always
 * `count === 1` when called immediately after
 * `lockOwnedActiveCartInTransaction` on the same row within the same
 * transaction (the lock already proved `status === 'ACTIVE'`); it is not
 * a second race, it confirms the lock held.
 */
export async function convertCartInTransaction(
  tx: TransactionClient,
  cartId: bigint,
): Promise<void> {
  const result = await tx.cart.updateMany({
    where: { id: cartId, status: "ACTIVE" },
    data: { status: "CONVERTED" },
  });
  if (result.count === 0) {
    // Unreachable given the calling contract above, but verified rather
    // than assumed (matches Phase 5/6's defensive style).
    throw new ConflictError("This cart has already been checked out.");
  }
}
