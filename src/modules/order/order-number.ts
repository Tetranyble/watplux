/**
 * Not sequential, not a raw incrementing integer — a predictable
 * customer-facing order number would let one customer enumerate/guess at
 * other customers' order references, an IDOR-adjacent risk
 * (docs/PHASE_6_ORDER_PLAN.md §21). Format: `ORD-YYYYMMDD-XXXXXX` (19
 * chars, well under the `orders.order_number` column's `VarChar(30)`) —
 * a date-based prefix plus a random alphanumeric suffix. The `@unique`
 * constraint on `orders.order_number` is the real safety net; a
 * collision (statistically negligible with this suffix length) surfaces
 * as an ordinary insert failure the caller can retry against, not
 * something this function itself needs to guard against.
 *
 * Lives at the module root, not `domain/`, matching the precedent
 * `src/modules/inventory/quantity.ts` set — the actual reason here is
 * different (this function is impure: `Date`/`Math.random`, whereas
 * `quantity.ts` was relocated for a Prisma-import-boundary reason), but
 * the same "small pure-ish helper outside domain/" module layout applies.
 */
export function generateOrderNumber(now: Date = new Date()): string {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD-${datePart}-${randomPart}`;
}
