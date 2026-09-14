"use client";

import { useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { Trash2 } from "lucide-react";

import { PriceDisplay } from "@/components/storefront/price-display";
import { Button } from "@/components/ui/button";
import { formatQuantity } from "@/lib/format";
import type { CartItemRecord } from "@/src/modules/cart/types";

/**
 * A real cart line — quantity update/remove go straight to the existing
 * `/api/cart/items/[itemId]` route (docs/PHASE_9_STOREFRONT_PLAN.md §11);
 * `onChanged` re-pulls the authoritative cart from the caller (never
 * updates local state optimistically with a client-computed total).
 */
export function CartLineItem({
  item,
  onChanged,
}: {
  item: CartItemRecord;
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function updateQuantity(nextQuantity: number) {
    if (nextQuantity < 1) return;
    startTransition(async () => {
      const res = await fetch(`/api/cart/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: nextQuantity }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Could not update this item.");
        return;
      }
      onChanged();
    });
  }

  function removeItem() {
    startTransition(async () => {
      const res = await fetch(`/api/cart/items/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Could not remove this item.");
        return;
      }
      onChanged();
    });
  }

  return (
    <div className="flex items-start gap-3 border-b py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.productName}</p>
        {item.variantLabel ? (
          <p className="text-xs text-muted-foreground">{item.variantLabel}</p>
        ) : null}
        {!item.isVariantActive ? (
          <p className="text-xs text-destructive">No longer available</p>
        ) : null}
        <div className="mt-2 flex items-center gap-3">
          <div className="flex items-center rounded-md border">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Decrease quantity"
              disabled={isPending}
              onClick={() => updateQuantity(item.quantity - 1)}
            >
              &minus;
            </Button>
            <span className="w-8 text-center text-xs" aria-live="polite">
              {formatQuantity(item.quantity)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Increase quantity"
              disabled={isPending}
              onClick={() => updateQuantity(item.quantity + 1)}
            >
              +
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${item.productName} from cart`}
            disabled={isPending}
            onClick={removeItem}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
      {/* `CartItemRecord` carries no `currency` field of its own (the
       * catalog's single-currency MVP scope — every variant defaults to
       * "NGN", docs/DATABASE_DESIGN.md), so this is a deliberate, scoped
       * hardcode, not an oversight. */}
      <PriceDisplay
        priceMinor={item.lineDisplayTotalMinor}
        compareAtPriceMinor={null}
        currency="NGN"
      />
    </div>
  );
}
