import { Prisma } from "@prisma/client";

/**
 * Pure order-total arithmetic — zero I/O (`domain/` layer). Importing
 * `Prisma.Decimal` as a *value* here (not database access) matches the
 * precedent Phase 5 set for `src/modules/inventory/quantity.ts` and
 * `domain/movement-semantics.ts`: arbitrary-precision decimal math is not
 * the same thing as touching Prisma's client/database, and money
 * arithmetic must never use JS floating-point (docs/ARCHITECTURE.md,
 * docs/DATABASE_DESIGN.md §19).
 *
 * Implements the exact, resolved formula from
 * `docs/PHASE_6_ORDER_PLAN.md` §15 — nothing here is a per-implementation
 * decision; the formula was fixed during plan review specifically so it
 * would not need to be decided here.
 */

/** Round-half-up to the nearest whole kobo — the rounding rule §15 leaves
 * to the application layer (no CHECK ties `line_total_minor` to the raw
 * `unit_price_minor * quantity` product, because `quantity` is
 * `DECIMAL` and can produce a fractional-kobo value). */
export function roundMinorUnits(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

export interface OrderLineInput {
  unitPriceMinor: number;
  quantity: Prisma.Decimal;
}

export interface OrderLineTotal {
  /** Always `0` for Phase 6 — no per-line discount/tax feature is built
   * yet; the column exists in the schema for a possible future feature
   * (plan §15). */
  discountMinor: number;
  /** Always `0` for Phase 6 — see `discountMinor`. */
  taxMinor: number;
  lineTotalMinor: number;
}

/** `lineTotalMinor = round(unitPriceMinor * quantity) - discountMinor +
 * taxMinor` — for Phase 6, `discountMinor`/`taxMinor` are always `0`, so
 * this simplifies to the rounded raw product, but the full formula is
 * expressed so a future per-line discount/tax feature slots in without
 * changing this function's shape. */
export function computeLineTotal(input: OrderLineInput): OrderLineTotal {
  const discountMinor = 0;
  const taxMinor = 0;
  const rawProduct = new Prisma.Decimal(input.unitPriceMinor).times(
    input.quantity,
  );
  const lineTotalMinor = roundMinorUnits(rawProduct) - discountMinor + taxMinor;
  return { discountMinor, taxMinor, lineTotalMinor };
}

export interface OrderTotalsInput {
  lines: OrderLineTotal[];
  /** `CouponRedemption.discountAppliedMinor` if exactly one redemption
   * applies to this order, else `0` (plan §15 point 3). Phase 6 does not
   * build coupon code validation/redemption logic — only this field's
   * fixed position in the formula — so this is always `0` in practice
   * until a later phase wires up an actual redemption use-case. */
  orderLevelDiscountMinor: number;
  /** Flat, server-computed value; `0` unless a specific flat value is
   * explicitly requested (plan §15 point 4). No shipping-rate engine is
   * built. */
  deliveryFeeMinor: number;
  /** Flat, server-computed value; `0` unless a specific flat value is
   * explicitly requested (plan §15 point 4). No tax-jurisdiction engine
   * is built. */
  orderLevelTaxMinor: number;
}

export interface OrderTotals {
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * `subtotalMinor = sum(lineTotalMinor)`,
 * `totalMinor = subtotalMinor - discountMinor + deliveryFeeMinor + taxMinor`
 * — exactly `chk_orders_total_arithmetic` (the real, DB-enforced CHECK
 * constraint on `orders`), satisfied by construction, never by hoping the
 * arithmetic happens to line up.
 */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const subtotalMinor = input.lines.reduce(
    (sum, line) => sum + line.lineTotalMinor,
    0,
  );
  const totalMinor =
    subtotalMinor -
    input.orderLevelDiscountMinor +
    input.deliveryFeeMinor +
    input.orderLevelTaxMinor;

  return {
    subtotalMinor,
    discountMinor: input.orderLevelDiscountMinor,
    deliveryFeeMinor: input.deliveryFeeMinor,
    taxMinor: input.orderLevelTaxMinor,
    totalMinor,
  };
}
