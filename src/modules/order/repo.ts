import { Prisma } from "@prisma/client";
import type { Order, OrderAddressType } from "@prisma/client";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
// Repo-to-repo import — ESLint-legal (the `boundaries/dependencies` rule
// disallows `repo` files from importing `use-case`/`presentation`/
// `component`/`domain`/`job` *elements*, but does not list the `repo`
// *file category* itself in any `disallow.to` clause, confirmed against
// `eslint.config.mjs` during planning — docs/PHASE_6_ORDER_PLAN.md §7,
// Option A). This is the only cross-module import in this file, and it
// only reaches Inventory's transaction-composition primitives, never its
// use-cases or any HTTP-facing surface.
import * as inventoryRepo from "@/src/modules/inventory/repo";

/**
 * Data access layer — the only file in this module allowed to import the
 * Prisma client, per docs/ARCHITECTURE.md §1. Every `$transaction`
 * boundary lives here.
 *
 * Reads `product_variants`/`products` directly (Catalog domain tables) to
 * resolve order-line snapshots — this mirrors Inventory's own established
 * precedent of reading `order_items` directly from its own `repo.ts`
 * (`docs/PHASE_5_INVENTORY_IMPLEMENTATION.md`): the "only repo.ts touches
 * Prisma" rule is about *which layer* may use the Prisma client, not
 * about which module "owns" which table exclusively — there is one
 * Prisma client (`lib/db.ts`) with every model on it.
 */

type TransactionClient = Prisma.TransactionClient;

const ORDER_DETAIL_INCLUDE = {
  items: true,
  addresses: true,
  statusHistory: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
  },
};

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: {
    items: true;
    addresses: true;
    statusHistory: true;
  };
}>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findOrderById(
  id: bigint,
): Promise<OrderWithRelations | null> {
  return db.order.findUnique({ where: { id }, include: ORDER_DETAIL_INCLUDE });
}

export async function findOrderByOrderNumber(
  orderNumber: string,
): Promise<OrderWithRelations | null> {
  return db.order.findUnique({
    where: { orderNumber },
    include: ORDER_DETAIL_INCLUDE,
  });
}

export interface OrderListCursor {
  createdAt: Date;
  id: bigint;
}

/** Base64url of `createdAt|id`, matching
 * `src/modules/inventory/repo.ts`'s `MovementCursor` pattern exactly. */
export function encodeOrderListCursor(cursor: OrderListCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString(
    "base64url",
  );
}

export function decodeOrderListCursor(raw: string): OrderListCursor | null {
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

/** List views select the plain `Order` row only (no items/addresses/
 * history) — matching `docs/PHASE_4_CATALOG_PLAN.md`'s "list use-cases
 * select only what a card needs" convention. */
export async function listOrdersForUser(
  userId: bigint,
  cursor: OrderListCursor | undefined,
  limit: number,
): Promise<{ rows: Order[]; nextCursor: string | null }> {
  const rows = await db.order.findMany({
    where: {
      userId,
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

  return paginate(rows, limit);
}

export interface ListOrdersForAdminFilters {
  status?: Order["status"];
  cursor?: OrderListCursor;
  limit: number;
  // --- Phase 10 additive extensions (docs/PHASE_10_ADMIN_PLAN.md §12/§28.5) ---
  // All optional; omitting every one of them reproduces the exact prior
  // behavior for the one existing caller.
  dateFrom?: Date;
  dateTo?: Date;
  /** Substring match against `orderNumber` — same `contains` convention
   * Catalog's own `search` filter already established. */
  orderNumber?: string;
  /** Matches either a guest order's own `guestEmail` OR a registered
   * customer's `user.email` via the existing relation — no schema
   * change, a plain Prisma relation filter. */
  customerEmail?: string;
}

export async function listOrdersForAdmin(
  filters: ListOrdersForAdminFilters,
): Promise<{ rows: Order[]; nextCursor: string | null }> {
  // Two independent conditions can each need their own `OR` (the cursor
  // boundary, and the customer-email search) — spreading both into one
  // plain object would collide on the literal `OR` key, with the second
  // silently overwriting the first (e.g. paginating page 2+ of an
  // email search would silently drop the email filter). Every condition
  // therefore goes into one `AND` array instead, so each `OR` stays
  // independently scoped no matter how many of these filters are active
  // together.
  const conditions: Prisma.OrderWhereInput[] = [];
  if (filters.status) {
    conditions.push({ status: filters.status });
  }
  if (filters.dateFrom || filters.dateTo) {
    conditions.push({
      createdAt: {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      },
    });
  }
  if (filters.orderNumber) {
    conditions.push({ orderNumber: { contains: filters.orderNumber } });
  }
  if (filters.customerEmail) {
    conditions.push({
      OR: [
        { guestEmail: { contains: filters.customerEmail } },
        { user: { email: { contains: filters.customerEmail } } },
      ],
    });
  }
  if (filters.cursor) {
    conditions.push({
      OR: [
        { createdAt: { lt: filters.cursor.createdAt } },
        { createdAt: filters.cursor.createdAt, id: { lt: filters.cursor.id } },
      ],
    });
  }

  const rows = await db.order.findMany({
    where: conditions.length > 0 ? { AND: conditions } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: filters.limit + 1,
  });

  return paginate(rows, filters.limit);
}

function paginate<T extends { id: bigint; createdAt: Date }>(
  rows: T[],
  limit: number,
): { rows: T[]; nextCursor: string | null } {
  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasNextPage && lastRow
      ? encodeOrderListCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
      : null;
  return { rows: pageRows, nextCursor };
}

// ---------------------------------------------------------------------------
// Order-line snapshot resolution (plain reads, pre-transaction)
// ---------------------------------------------------------------------------

export interface ResolvedOrderLine {
  variantId: bigint;
  productId: bigint;
  productNameSnapshot: string;
  skuSnapshot: string;
  variantLabelSnapshot: string | null;
  unitPriceMinor: number;
}

/**
 * Resolves current price/SKU/name for one requested line
 * (docs/PHASE_6_ORDER_PLAN.md §5 step 1) — a plain read via `db`, never
 * `tx`, and never inside the create-order transaction: there is no
 * invariant requiring the price to be frozen between this read and the
 * transaction, so no lock is needed, and nothing later in the create-order
 * transaction re-reads variant/product data (it's already captured into
 * the resolved value returned here).
 */
export async function resolveOrderLine(
  variantId: bigint,
): Promise<ResolvedOrderLine> {
  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true },
  });
  if (!variant) {
    throw new NotFoundError(`Product variant ${variantId} not found.`);
  }
  if (variant.status !== "ACTIVE") {
    throw new ValidationError(
      `Product variant ${variantId} is not available for purchase.`,
    );
  }

  return {
    variantId: variant.id,
    productId: variant.productId,
    productNameSnapshot: variant.product.name,
    skuSnapshot: variant.sku,
    variantLabelSnapshot: variant.variantLabel,
    unitPriceMinor: variant.priceMinor,
  };
}

// ---------------------------------------------------------------------------
// Order creation — one atomic transaction with Inventory reservation
// ---------------------------------------------------------------------------

export interface CreateOrderLineData {
  variantId: bigint;
  productId: bigint;
  productNameSnapshot: string;
  skuSnapshot: string;
  variantLabelSnapshot: string | null;
  unitPriceMinor: number;
  quantity: Prisma.Decimal;
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

export interface OrderAddressData {
  type: OrderAddressType;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  deliveryNotes: string | null;
}

export interface CreateOrderData {
  orderNumber: string;
  userId: bigint | null;
  guestEmail: string | null;
  guestPhone: string | null;
  customerNote: string | null;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  lines: CreateOrderLineData[];
  shippingAddress: OrderAddressData;
  billingAddress: OrderAddressData | null;
  /** Who/what created this order — plan §3's actor-mapping table
   * ("Customer creates their own order" -> SYSTEM, actorId = their
   * userId or null for guest). No `CUSTOMER` value exists on
   * `OrderStatusHistoryActorType`. */
  initialActorId: bigint | null;
}

/**
 * Order creation and initial inventory reservation, composed into a
 * transaction the CALLER already owns (docs/PHASE_7_CART_CHECKOUT_PLAN.md
 * §17, mirroring Phase 6 §7's exact "Option A" resolution one level
 * higher). Additive: contains exactly the body `createOrder`'s own
 * `db.$transaction` callback had before this phase — `order_items` must
 * be created before any `RESERVE` movement can reference them, per the
 * existing FK (`inventory_movements.order_item_id -> order_items.id`),
 * which makes "reservation succeeds, order creation fails" structurally
 * impossible.
 *
 * Never imported outside a `repo.ts` file: the `Prisma.TransactionClient`
 * parameter never crosses into a use-case, domain, or presentation
 * module. Composed by `checkout/repo.ts`'s own outer transaction; `Order`
 * itself still uses the standalone `createOrder` below unchanged.
 */
export async function createOrderInTransaction(
  tx: TransactionClient,
  data: CreateOrderData,
): Promise<OrderWithRelations> {
  const order = await tx.order.create({
    data: {
      orderNumber: data.orderNumber,
      userId: data.userId,
      guestEmail: data.guestEmail,
      guestPhone: data.guestPhone,
      status: "PENDING_PAYMENT",
      subtotalMinor: data.subtotalMinor,
      discountMinor: data.discountMinor,
      deliveryFeeMinor: data.deliveryFeeMinor,
      taxMinor: data.taxMinor,
      totalMinor: data.totalMinor,
      currency: data.currency,
      customerNote: data.customerNote,
      items: {
        create: data.lines.map((line) => ({
          productId: line.productId,
          productVariantId: line.variantId,
          productNameSnapshot: line.productNameSnapshot,
          skuSnapshot: line.skuSnapshot,
          variantLabelSnapshot: line.variantLabelSnapshot,
          unitPriceMinor: line.unitPriceMinor,
          quantity: line.quantity,
          discountMinor: line.discountMinor,
          taxMinor: line.taxMinor,
          lineTotalMinor: line.lineTotalMinor,
        })),
      },
      addresses: {
        create: [
          data.shippingAddress,
          ...(data.billingAddress ? [data.billingAddress] : []),
        ],
      },
    },
    include: { items: true, addresses: true },
  });

  // Reservation requires the real, just-created `order_items.id` for
  // each line — resolved by matching on `productVariantId`, which is
  // `@@unique([orderId, productVariantId])` so this lookup is exact.
  for (const item of order.items) {
    if (item.productVariantId === null) {
      // Unreachable in practice (we always set it above), but verified
      // rather than assumed — matches Phase 5's own defensive style.
      throw new ValidationError(
        "Order item is missing its product variant association.",
      );
    }
    await inventoryRepo.reserveInventoryForNewOrderItem(tx, {
      orderItemId: item.id,
      variantId: item.productVariantId,
      quantity: item.quantity,
    });
  }

  const statusHistoryRow = await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      // No prior status exists for a brand-new order — an empty string
      // sentinel, since `from_status` is `NOT NULL` in the schema.
      fromStatus: "",
      toStatus: "PENDING_PAYMENT",
      actorType: "SYSTEM",
      actorId: data.initialActorId,
    },
  });

  return { ...order, statusHistory: [statusHistoryRow] };
}

/**
 * Order creation and initial inventory reservation are one atomic
 * transaction (docs/PHASE_6_ORDER_PLAN.md §5/§7). Unchanged public
 * signature/return type/behavior — now a thin wrapper around
 * `createOrderInTransaction` (docs/PHASE_7_CART_CHECKOUT_PLAN.md §17):
 * zero observable behavior change, confirmed by re-running Order's entire
 * existing test suite immediately after this addition.
 *
 * If any line's reservation fails (insufficient stock), the entire
 * transaction rolls back: no `orders` row, no `order_items`, no
 * `order_addresses`, no reservation, no `order_status_history` row
 * survive.
 */
export async function createOrder(
  data: CreateOrderData,
): Promise<OrderWithRelations> {
  return db.$transaction((tx) => createOrderInTransaction(tx, data));
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export interface CancelOrderData {
  orderId: bigint;
  actorType: "SYSTEM" | "ADMIN";
  actorId: bigint | null;
  note?: string;
}

/**
 * `PENDING_PAYMENT -> CANCELLED` only (docs/PHASE_6_ORDER_PLAN.md §10).
 * The conditional `UPDATE` is the same mechanism
 * `docs/ARCHITECTURE.md` §6.5 already established for the payment
 * transition — guard-failure triggers a recheck: already `CANCELLED` is
 * treated as an idempotent success (the desired end state already
 * holds); any other status is a genuine conflict.
 */
export async function cancelOrder(
  data: CancelOrderData,
): Promise<OrderWithRelations> {
  return db.$transaction(async (tx) => {
    const result = await tx.order.updateMany({
      where: { id: data.orderId, status: "PENDING_PAYMENT" },
      data: { status: "CANCELLED" },
    });

    if (result.count === 0) {
      const current = await tx.order.findUnique({
        where: { id: data.orderId },
        include: ORDER_DETAIL_INCLUDE,
      });
      if (!current) {
        throw new NotFoundError("Order not found.");
      }
      if (current.status === "CANCELLED") {
        return current;
      }
      throw new ConflictError("This order can no longer be cancelled.");
    }

    const items = await tx.orderItem.findMany({
      where: { orderId: data.orderId },
    });
    for (const item of items) {
      await inventoryRepo.releaseInventoryInTransaction(tx, {
        orderItemId: item.id,
      });
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: data.orderId,
        fromStatus: "PENDING_PAYMENT",
        toStatus: "CANCELLED",
        actorType: data.actorType,
        actorId: data.actorId,
        note: data.note,
      },
    });

    return tx.order.findUniqueOrThrow({
      where: { id: data.orderId },
      include: ORDER_DETAIL_INCLUDE,
    });
  });
}

// ---------------------------------------------------------------------------
// Payment success — inter-module contract
// ---------------------------------------------------------------------------

/**
 * Verifies the payment attempt exists, belongs to the exact order being
 * mutated, and has actually succeeded — the FK on
 * `orders.authoritative_payment_attempt_id -> payment_attempts.id` only
 * proves the referenced row exists, never that it names the correct
 * order (the exact bug shape Phase 5's `requireMatchingOrderItem`
 * addressed for `inventory_movements.order_item_id`,
 * docs/PHASE_6_ORDER_PLAN.md §8). Runs via `db`, before the transaction
 * opens: `payment_attempts.orderId` is set once at creation and never
 * updated, and its transition to `SUCCESS` is a one-way, terminal fact
 * the calling Payment module has already independently verified via
 * Paystack — this is a defense-in-depth relational guard, not a
 * race-sensitive read.
 */
async function requireMatchingPaymentAttempt(
  orderId: bigint,
  paymentAttemptId: bigint,
  client: TransactionClient = db,
): Promise<void> {
  const paymentAttempt = await client.paymentAttempt.findUnique({
    where: { id: paymentAttemptId },
  });
  if (!paymentAttempt) {
    throw new NotFoundError("Payment attempt not found.");
  }
  if (paymentAttempt.orderId !== orderId) {
    throw new ValidationError(
      "This payment attempt does not belong to the specified order.",
    );
  }
  if (paymentAttempt.status !== "SUCCESS") {
    throw new ValidationError(
      "This payment attempt has not succeeded; it cannot authorize a PAID transition.",
    );
  }
}

export interface MarkOrderPaidData {
  orderId: bigint;
  paymentAttemptId: bigint;
}

export interface MarkOrderPaidRepoResult {
  transitioned: boolean;
  order: OrderWithRelations;
}

/**
 * `PENDING_PAYMENT -> PAID`, composed into a transaction the CALLER
 * already owns (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §6.2, mirroring
 * Phase 7 §17's exact "Option A" resolution one level higher again).
 * Additive: contains exactly the body `markOrderPaid`'s own
 * `db.$transaction` callback had before this phase.
 *
 * The ownership/eligibility check (`requireMatchingPaymentAttempt`) runs
 * via `tx` here, not `db` — this is deliberate, not an oversight: the
 * Payment module's own composed transaction (plan §6.3) marks the
 * attempt `SUCCESS` as ITS first statement, in the same transaction,
 * before ever calling this function — a `db` read at this point would
 * not see that still-uncommitted write and would incorrectly reject a
 * genuinely-successful payment. A transaction always sees its own
 * uncommitted writes regardless of isolation level, so this is correct;
 * it is also this transaction's own first PLAIN read in the standalone
 * `markOrderPaid` case below, so it introduces no snapshot-poisoning risk
 * there either. The one read that WOULD be at risk if this poisoned the
 * snapshot — the guard-failure branch's "give me the current order" read
 * — is deliberately routed through `db`, not `tx`, below, exactly
 * mirroring `completeSaleInTransaction`'s own established guard-failure
 * pattern.
 */
export async function markOrderPaidInTransaction(
  tx: TransactionClient,
  data: MarkOrderPaidData,
): Promise<MarkOrderPaidRepoResult> {
  await requireMatchingPaymentAttempt(data.orderId, data.paymentAttemptId, tx);

  const result = await tx.order.updateMany({
    where: { id: data.orderId, status: "PENDING_PAYMENT" },
    data: {
      status: "PAID",
      authoritativePaymentAttemptId: data.paymentAttemptId,
    },
  });

  if (result.count === 0) {
    // Deliberately `db`, not `tx` — see the function doc comment above.
    const current = await db.order.findUnique({
      where: { id: data.orderId },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (!current) {
      throw new NotFoundError("Order not found.");
    }
    return { transitioned: false, order: current };
  }

  const items = await tx.orderItem.findMany({
    where: { orderId: data.orderId },
  });
  for (const item of items) {
    await inventoryRepo.completeSaleInTransaction(tx, {
      orderItemId: item.id,
    });
  }

  await tx.orderStatusHistory.create({
    data: {
      orderId: data.orderId,
      fromStatus: "PENDING_PAYMENT",
      toStatus: "PAID",
      actorType: "WEBHOOK",
      actorId: null,
    },
  });

  const updated = await tx.order.findUniqueOrThrow({
    where: { id: data.orderId },
    include: ORDER_DETAIL_INCLUDE,
  });
  return { transitioned: true, order: updated };
}

/**
 * `PENDING_PAYMENT -> PAID`, atomically with `authoritative_payment_attempt_id`
 * assignment and inventory `RESERVE -> SALE` conversion for every line
 * (docs/PHASE_6_ORDER_PLAN.md §8). No actor, no permission check — an
 * inter-module contract, exactly mirroring Inventory's
 * `completeInventorySale({ orderItemId })` shape. Unchanged public
 * signature/return type/behavior — now a thin wrapper around
 * `markOrderPaidInTransaction` (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md
 * §6.2): zero observable behavior change, confirmed by re-running
 * Order's entire existing test suite immediately after this addition.
 *
 * Returns `{ transitioned: false, order }` — never throws — when the
 * order is already `PAID` (§12, a genuine race between two successful
 * payment attempts) or already `CANCELLED` (§11, a late webhook after
 * cancellation): the order is never resurrected to `PAID` under any
 * circumstance, and the caller (the Payment module) needs to distinguish
 * these from a hard error.
 */
export async function markOrderPaid(
  data: MarkOrderPaidData,
): Promise<MarkOrderPaidRepoResult> {
  return db.$transaction((tx) => markOrderPaidInTransaction(tx, data));
}

// ---------------------------------------------------------------------------
// Admin dashboard metrics (docs/PHASE_10_ADMIN_PLAN.md §9) — read-only,
// derived entirely from existing columns/indexes, no new infrastructure.
// ---------------------------------------------------------------------------

// `Order["status"]` (the Prisma-generated column type), not the domain
// module's `OrderStatus` — `repo.ts` may not import `domain/**`
// (eslint boundaries), matching this file's own existing
// `ListOrdersForAdminFilters.status?: Order["status"]` convention.
const REVENUE_STATUSES: Order["status"][] = [
  "PAID",
  "PROCESSING",
  "READY_FOR_DISPATCH",
  "SHIPPED",
  "DELIVERED",
];

export interface OrderMetrics {
  totalOrders: number;
  ordersByStatus: Record<Order["status"], number>;
  paidRevenueMinor: number;
}

/** One `groupBy` for the total+per-status counts, one `aggregate` for
 * revenue — two indexed queries, no N+1, matching the query-count
 * discipline established in Phase 9's own performance verification. */
export async function getOrderMetrics(): Promise<OrderMetrics> {
  const [statusGroups, revenue] = await Promise.all([
    db.order.groupBy({ by: ["status"], _count: { _all: true } }),
    db.order.aggregate({
      _sum: { totalMinor: true },
      where: { status: { in: REVENUE_STATUSES } },
    }),
  ]);

  const ordersByStatus = {
    PENDING_PAYMENT: 0,
    PAID: 0,
    PROCESSING: 0,
    READY_FOR_DISPATCH: 0,
    SHIPPED: 0,
    DELIVERED: 0,
    CANCELLED: 0,
    REFUNDED: 0,
  } as Record<Order["status"], number>;
  let totalOrders = 0;
  for (const group of statusGroups) {
    ordersByStatus[group.status] = group._count._all;
    totalOrders += group._count._all;
  }

  return {
    totalOrders,
    ordersByStatus,
    paidRevenueMinor: revenue._sum.totalMinor ?? 0,
  };
}
