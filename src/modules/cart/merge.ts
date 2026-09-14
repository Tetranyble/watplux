import { Prisma } from "@prisma/client";

/**
 * Pure guest-to-authenticated cart merge policy — zero I/O
 * (docs/PHASE_7_CART_CHECKOUT_PLAN.md §6/§28, unit-tested exhaustively
 * per the plan's own testing-matrix requirement: "given two item lists,
 * produce the merged result"). Deliberately lives at the module root,
 * NOT `domain/merge.ts` — the exact same reason
 * `order/quantity.ts`/`inventory/quantity.ts` were placed outside
 * `domain/`: `repo.ts` needs to call this from inside its own guarded
 * transaction (plan §6/§11), and the ESLint `boundaries/dependencies`
 * rule forbids `repo.ts` from importing anything classified as `domain`.
 *
 * The actual cart-row locking/upsert/status-transition mechanics live in
 * `repo.ts`; this function is only the *decision*: which variant ends up
 * with which final quantity, and which guest lines are dropped entirely.
 *
 * Policy (plan §6): quantities summed for a variant present in both
 * carts; an inactive/archived guest variant is dropped, never copied;
 * user-only and guest-only (active) variants pass through unchanged.
 */

export interface MergeCartItemInput {
  productVariantId: bigint;
  quantity: Prisma.Decimal;
}

export interface GuestMergeCartItemInput extends MergeCartItemInput {
  isVariantActive: boolean;
}

export interface MergedCartLine {
  productVariantId: bigint;
  quantity: Prisma.Decimal;
}

export function computeMergedCartLines(
  userItems: MergeCartItemInput[],
  guestItems: GuestMergeCartItemInput[],
): MergedCartLine[] {
  const byVariant = new Map<string, MergedCartLine>();

  for (const item of userItems) {
    byVariant.set(item.productVariantId.toString(), {
      productVariantId: item.productVariantId,
      quantity: item.quantity,
    });
  }

  for (const item of guestItems) {
    if (!item.isVariantActive) {
      // Dropped, not copied — plan §6.
      continue;
    }
    const key = item.productVariantId.toString();
    const existing = byVariant.get(key);
    byVariant.set(key, {
      productVariantId: item.productVariantId,
      quantity: existing
        ? existing.quantity.plus(item.quantity)
        : item.quantity,
    });
  }

  return Array.from(byVariant.values());
}
