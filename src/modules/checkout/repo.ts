import { Prisma } from "@prisma/client";
import type { PaymentAttempt } from "@prisma/client";

import { db } from "@/lib/db";
import { generatePaystackSafeReference } from "@/src/integrations/paystack/reference";
// Repo-to-repo imports — ESLint-legal, the same "Option A" pattern
// docs/PHASE_6_ORDER_PLAN.md §7 established for Order<->Inventory,
// extended one level higher (docs/PHASE_7_CART_CHECKOUT_PLAN.md §14/§17):
// Checkout's repo owns the ONE outer transaction and composes Cart's and
// Order's own tx-accepting primitives into it. Never imports either
// module's use-cases or any HTTP-facing surface.
import * as cartRepo from "@/src/modules/cart/repo";
import type { CartOwner } from "@/src/modules/cart/types";
import { generateOrderNumber } from "@/src/modules/order/order-number";
import * as orderRepo from "@/src/modules/order/repo";
import type {
  OrderAddressData,
  OrderWithRelations,
} from "@/src/modules/order/repo";

/**
 * Data access layer — the only file in this module allowed to import the
 * Prisma client, per docs/ARCHITECTURE.md §1. Owns the ONE checkout
 * transaction (plan §16/§18/§19): Checkout repo -> Cart repo -> Order
 * repo -> Inventory repo -> Prisma -> MySQL, one commit boundary, never
 * two separate transactions for what must succeed or fail together.
 *
 * `computeLineTotal`/`computeOrderTotals` below are a deliberate, small
 * inline duplication of `order/domain/order-totals.ts`'s identical
 * formula — NOT imported from there: the ESLint `boundaries/dependencies`
 * rule forbids any `repo.ts` from importing a `domain` module (the exact
 * rule that keeps `order/repo.ts` from importing its own
 * `order/domain/order-totals.ts` either — that computation lives in
 * `order/use-cases/create-order.ts` instead). Checkout's totals must be
 * computed from cart items only knowable *after* the cart lock inside
 * this transaction (plan §16), so the math is reproduced here rather
 * than the use-case layer, matching Order's own resolved formula exactly
 * (`chk_orders_total_arithmetic`).
 */

function roundMinorUnits(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

interface CheckoutLineTotal {
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

function computeLineTotal(input: {
  unitPriceMinor: number;
  quantity: Prisma.Decimal;
}): CheckoutLineTotal {
  // Always 0 for Phase 7 — no per-line discount/tax feature is built yet,
  // identical to Order's own Phase 6 formula.
  const discountMinor = 0;
  const taxMinor = 0;
  const rawProduct = new Prisma.Decimal(input.unitPriceMinor).times(
    input.quantity,
  );
  const lineTotalMinor = roundMinorUnits(rawProduct) - discountMinor + taxMinor;
  return { discountMinor, taxMinor, lineTotalMinor };
}

function computeOrderTotals(lines: CheckoutLineTotal[]): {
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
} {
  const subtotalMinor = lines.reduce(
    (sum, line) => sum + line.lineTotalMinor,
    0,
  );
  // Order-level discount/delivery/tax are always 0 for Phase 7 — no
  // coupon-redemption or shipping-rate/tax engine is built (out of
  // scope, plan §3), identical to Order's own Phase 6 defaults.
  return {
    subtotalMinor,
    discountMinor: 0,
    deliveryFeeMinor: 0,
    taxMinor: 0,
    totalMinor: subtotalMinor,
  };
}

export interface CompleteCheckoutData {
  cartId: bigint;
  owner: CartOwner;
  userId: bigint | null;
  guestEmail: string | null;
  guestPhone: string | null;
  customerNote: string | null;
  shippingAddress: OrderAddressData;
  billingAddress: OrderAddressData | null;
  /** Actor-mapping convention identical to Order's own (plan §16 mirrors
   * `docs/PHASE_6_ORDER_PLAN.md` §3): the customer/guest performing their
   * own checkout is always SYSTEM, actorId = their userId or null. */
  initialActorId: bigint | null;
}

export interface CompleteCheckoutResult {
  order: OrderWithRelations;
  paymentAttemptId: bigint;
  paymentAttemptReference: string;
}

/**
 * The exact sequence from plan §16, derived from (not copied verbatim
 * from) the brief's illustrative sketch: inventory reservation is nested
 * *inside* `createOrderInTransaction` because that is what Phase 6
 * already built and tested — Checkout does not re-implement or duplicate
 * that internal ordering.
 *
 * `orderRepo.resolveOrderLine` is called here via `db` (not `tx`,
 * unchanged from its own implementation) — this is safe and deliberate:
 * a plain `db` read does not touch this transaction's REPEATABLE READ
 * snapshot at all (it runs on its own separate connection), so calling it
 * *after* the cart-row lock below is not a snapshot-poisoning risk the
 * way a plain `tx` read would be. The lock above remains this
 * transaction's genuine first *locking* statement.
 *
 * Cart item quantities are not re-validated for format here: every
 * `cart_items.quantity` value already passed the identical
 * finite/positive/3dp checks at add/update time (plan §8) and is
 * immutable outside those validated mutations — nothing in this
 * transaction can have produced an invalid quantity.
 */
export async function completeCheckout(
  data: CompleteCheckoutData,
): Promise<CompleteCheckoutResult> {
  const order = await db.$transaction(async (tx) => {
    const locked = await cartRepo.lockOwnedActiveCartInTransaction(
      tx,
      data.cartId,
      data.owner,
    );

    const resolvedLines = [];
    for (const item of locked.items) {
      // Reused verbatim from Phase 6 (plan §7/§16) — throws
      // NotFoundError/ValidationError for a missing/inactive variant,
      // satisfying the "variant exists and is ACTIVE" checkout
      // validation (plan §20) with no separate check needed.
      const resolved = await orderRepo.resolveOrderLine(item.productVariantId);
      resolvedLines.push({ resolved, quantity: item.quantity });
    }

    const lineTotals = resolvedLines.map(({ resolved, quantity }) =>
      computeLineTotal({ unitPriceMinor: resolved.unitPriceMinor, quantity }),
    );
    const totals = computeOrderTotals(lineTotals);

    const createdOrder = await orderRepo.createOrderInTransaction(tx, {
      orderNumber: generateOrderNumber(),
      userId: data.userId,
      guestEmail: data.guestEmail,
      guestPhone: data.guestPhone,
      customerNote: data.customerNote,
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      deliveryFeeMinor: totals.deliveryFeeMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      currency: "NGN",
      lines: resolvedLines.map(({ resolved, quantity }, index) => ({
        variantId: resolved.variantId,
        productId: resolved.productId,
        productNameSnapshot: resolved.productNameSnapshot,
        skuSnapshot: resolved.skuSnapshot,
        variantLabelSnapshot: resolved.variantLabelSnapshot,
        unitPriceMinor: resolved.unitPriceMinor,
        quantity,
        discountMinor: lineTotals[index]!.discountMinor,
        taxMinor: lineTotals[index]!.taxMinor,
        lineTotalMinor: lineTotals[index]!.lineTotalMinor,
      })),
      shippingAddress: data.shippingAddress,
      billingAddress: data.billingAddress,
      initialActorId: data.initialActorId,
    });

    // The guarded ACTIVE -> CONVERTED transition — by construction this
    // is the SAME row already locked above, so this always succeeds; it
    // confirms the lock held, it is not a second race (plan §16).
    await cartRepo.convertCartInTransaction(tx, data.cartId);

    return createdOrder;
  });

  // Outside the transaction, as a separate step (plan §18/§29) — no
  // external network call here or anywhere near it: this is a single-row
  // insert. The (Phase 8) Paystack call is explicitly out of scope.
  const paymentAttempt = await createInitialPaymentAttempt(
    order.id,
    order.totalMinor,
  );

  return {
    order,
    paymentAttemptId: paymentAttempt.id,
    paymentAttemptReference: paymentAttempt.paystackReference,
  };
}

/**
 * Phase 7 creates ONLY this row — `status: "INITIATED"`, no Paystack
 * call, no `authorizationUrl`/`accessCode` population, no verification
 * logic (plan §18, Option A). Lives here, not in Order's repo — Order
 * explicitly does not own payment state
 * (docs/PHASE_6_ORDER_PLAN.md §8).
 *
 * Reference generation corrected in Phase 8
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §8.3): Phase 7's original
 * `` `CHKOUT-${generateRawToken()}` `` used base64url, whose alphabet
 * includes `_` — not in Paystack's documented reference character set
 * (alphanumeric plus `-`, `.`, `=`). Phase 7 never actually sent this
 * reference to Paystack (explicitly out of scope then), so this is a
 * pure, disclosed correction at the source — every attempt from this
 * point forward gets a Paystack-safe reference from the moment it is
 * created, before any external call is ever made against it.
 */
export async function createInitialPaymentAttempt(
  orderId: bigint,
  amountMinor: number,
): Promise<PaymentAttempt> {
  return db.paymentAttempt.create({
    data: {
      orderId,
      paystackReference: generatePaystackSafeReference("CHKOUT"),
      amountMinor,
      status: "INITIATED",
    },
  });
}
