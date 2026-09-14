import { Prisma } from "@prisma/client";

import { ValidationError } from "@/lib/errors";
import { getAvailableQuantity } from "@/src/modules/inventory/use-cases/get-available-quantity";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import {
  computeLineTotal,
  computeOrderTotals,
} from "@/src/modules/order/domain/order-totals";
import { generateOrderNumber } from "@/src/modules/order/order-number";
import * as orderRepo from "@/src/modules/order/repo";
import { toOrderDetail } from "@/src/modules/order/types";
import type {
  AddressInput,
  CreateOrderInput,
} from "@/src/modules/order/schema";
import type { OrderAddressData } from "@/src/modules/order/repo";
import type { OrderDetail } from "@/src/modules/order/types";

/**
 * Order creation and initial inventory reservation are one atomic
 * transaction (docs/PHASE_6_ORDER_PLAN.md §5/§7) — this use-case does the
 * pre-transaction work (resolve pricing, validate, compute totals,
 * generate the order number) and delegates the transaction itself to
 * `orderRepo.createOrder`. `actor` is optional — guest checkout is a
 * first-class case (§1).
 *
 * `getAvailableQuantity` is Inventory's own framework-agnostic,
 * unauthenticated read primitive (`docs/PHASE_5_INVENTORY_PLAN.md` §9) —
 * calling it here is exactly the cross-module use-case-to-use-case
 * composition it was built for, and is only ever a non-authoritative
 * pre-check (the guarded `UPDATE` inside the transaction is authoritative).
 */
export async function createOrder(
  actor: AuthenticatedUser | null,
  input: CreateOrderInput,
): Promise<OrderDetail> {
  if (!actor && !input.guestEmail) {
    throw new ValidationError(
      "Guest checkout requires a contact email address.",
    );
  }

  const variantIds = input.lines.map((line) => line.variantId.toString());
  if (new Set(variantIds).size !== variantIds.length) {
    throw new ValidationError(
      "Each product variant may only appear once per order — combine quantities into a single line.",
    );
  }

  // Pre-transaction (plan §5 step 1-3): resolve current pricing/identity
  // for every line via a plain `db` read (no lock needed — nothing later
  // re-reads variant/product data), plus a fast, non-authoritative
  // availability pre-check. Neither is the authoritative stock check —
  // that's the guarded `UPDATE` inside `orderRepo.createOrder`'s own
  // transaction.
  const resolvedLines = [];
  for (const line of input.lines) {
    const resolved = await orderRepo.resolveOrderLine(line.variantId);
    const availableQuantity = await getAvailableQuantity(line.variantId);
    if (availableQuantity < line.quantity) {
      throw new ValidationError(
        `Insufficient stock for ${resolved.skuSnapshot}.`,
      );
    }
    resolvedLines.push({
      resolved,
      quantity: new Prisma.Decimal(line.quantity),
    });
  }

  // Totals computed server-side (plan §15) — never from any
  // client-submitted price/total/discount field, which the Zod input
  // schema doesn't even accept in the first place.
  const lineTotals = resolvedLines.map(({ resolved, quantity }) =>
    computeLineTotal({ unitPriceMinor: resolved.unitPriceMinor, quantity }),
  );
  const totals = computeOrderTotals({
    lines: lineTotals,
    orderLevelDiscountMinor: 0,
    deliveryFeeMinor: 0,
    orderLevelTaxMinor: 0,
  });

  const order = await orderRepo.createOrder({
    orderNumber: generateOrderNumber(),
    userId: actor?.id ?? null,
    guestEmail: actor ? null : (input.guestEmail ?? null),
    guestPhone: actor ? null : (input.guestPhone ?? null),
    customerNote: input.customerNote ?? null,
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
    shippingAddress: toOrderAddressData("SHIPPING", input.shippingAddress),
    billingAddress: input.billingAddress
      ? toOrderAddressData("BILLING", input.billingAddress)
      : null,
    initialActorId: actor?.id ?? null,
  });

  return toOrderDetail(order);
}

function toOrderAddressData(
  type: "SHIPPING" | "BILLING",
  input: AddressInput,
): OrderAddressData {
  return {
    type,
    fullName: input.fullName,
    phone: input.phone,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    city: input.city,
    state: input.state,
    country: input.country,
    postalCode: input.postalCode ?? null,
    deliveryNotes: input.deliveryNotes ?? null,
  };
}
