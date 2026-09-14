import { Prisma } from "@prisma/client";
import type { Cart, CartItem, Product, ProductVariant } from "@prisma/client";

import type { CartStatus } from "@/src/modules/cart/domain/cart-state-machine";

/**
 * Safe, client-returnable projections — the only shapes any cart use-case
 * is allowed to hand back to a caller (same convention as
 * `src/modules/order/types.ts`). BigInt ids are always stringified;
 * Prisma `Decimal` fields are always converted to plain `number` before
 * crossing this boundary — display-only, never used for further
 * arithmetic (checkout re-derives everything server-side from
 * `productVariantId`/`quantity` alone, plan §7/§20).
 */

/**
 * Identifies who a cart mutation/read is being performed on behalf of —
 * the only two identity axes the schema provides (plan §3), mutually
 * exclusive by construction (mirrors `chk_carts_identity_exclusive`).
 * Never constructed from client-supplied `userId`/`guestTokenHash` —
 * always resolved server-side by `lib/cart-actor.ts`.
 */
export type CartOwner =
  { type: "user"; userId: bigint } | { type: "guest"; guestTokenHash: string };

/** Round-half-up to the nearest whole kobo — display-only arithmetic
 * (never written back to the database; checkout re-resolves everything
 * authoritatively via `order/domain/order-totals.ts`, plan §7/§9). A
 * small, deliberate duplication of that module's identical rounding
 * rule, matching the established Phase 4-7 independence precedent. */
function roundMinorUnits(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

export interface CartItemRecord {
  id: string;
  productVariantId: string;
  productId: string;
  productName: string;
  sku: string;
  variantLabel: string | null;
  isVariantActive: boolean;
  quantity: number;
  /** Display-only snapshot, refreshed on every mutation — never
   * authoritative (plan §7). */
  priceSnapshotMinor: number;
  /** `priceSnapshotMinor * quantity`, rounded — a display convenience
   * only; checkout never reads this field. */
  lineDisplayTotalMinor: number;
  createdAt: string;
  updatedAt: string;
}

export interface CartSummary {
  id: string;
  status: CartStatus;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CartDetail extends CartSummary {
  items: CartItemRecord[];
  /** Sum of every line's `lineDisplayTotalMinor` — display-only,
   * never the authoritative order subtotal (plan §9). */
  subtotalDisplayMinor: number;
}

type CartItemWithVariant = CartItem & {
  productVariant: ProductVariant & { product: Product };
};

export function toCartItemRecord(item: CartItemWithVariant): CartItemRecord {
  const lineDisplayTotalMinor = roundMinorUnits(
    new Prisma.Decimal(item.priceSnapshotMinor).times(item.quantity),
  );
  return {
    id: item.id.toString(),
    productVariantId: item.productVariantId.toString(),
    productId: item.productVariant.productId.toString(),
    productName: item.productVariant.product.name,
    sku: item.productVariant.sku,
    variantLabel: item.productVariant.variantLabel,
    isVariantActive: item.productVariant.status === "ACTIVE",
    quantity: item.quantity.toNumber(),
    priceSnapshotMinor: item.priceSnapshotMinor,
    lineDisplayTotalMinor,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toCartDetail(
  cart: Cart,
  items: CartItemWithVariant[],
): CartDetail {
  const itemRecords = items.map(toCartItemRecord);
  return {
    id: cart.id.toString(),
    status: cart.status,
    itemCount: itemRecords.length,
    createdAt: cart.createdAt.toISOString(),
    updatedAt: cart.updatedAt.toISOString(),
    items: itemRecords,
    subtotalDisplayMinor: itemRecords.reduce(
      (sum, item) => sum + item.lineDisplayTotalMinor,
      0,
    ),
  };
}
