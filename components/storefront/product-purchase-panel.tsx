"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/ui/toast";

import { PriceDisplay } from "@/components/storefront/price-display";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CatalogVariant } from "@/src/modules/catalog/types";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

/**
 * The one genuinely interactive PDP region — variant selection, quantity,
 * and add-to-cart. Everything it needs (variants, live availability) was
 * already fetched server-side and passed in as props; it never becomes
 * authoritative for price/stock itself, it only displays what the server
 * already computed and re-reads it again via the real `/api/cart/items`
 * route on submit (docs/PHASE_9_STOREFRONT_PLAN.md §3.3/§8/§21: the
 * client submits only `variantId`+`quantity`, never a price).
 */
export function ProductPurchasePanel({
  variants,
  availableQuantityByVariantId,
}: {
  variants: CatalogVariant[];
  availableQuantityByVariantId: Record<string, number>;
}) {
  const copy = useSiteCopy();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const activeVariants = variants.filter((v) => v.status === "ACTIVE");
  const initialVariant =
    activeVariants.find((v) => v.isDefault) ?? activeVariants[0] ?? variants[0];
  const [selectedVariantId, setSelectedVariantId] = useState(
    initialVariant?.id,
  );
  const [quantity, setQuantity] = useState(1);

  const selectedVariant = variants.find((v) => v.id === selectedVariantId);
  const availableQuantity = selectedVariant
    ? (availableQuantityByVariantId[selectedVariant.id] ?? 0)
    : 0;

  if (!selectedVariant) {
    return (
      <p className="text-sm text-muted-foreground">
        {copy("catalog.purchase.unavailable")}
      </p>
    );
  }

  function handleAddToCart() {
    if (!selectedVariant) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variantId: selectedVariant.id, quantity }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          toast.error(body?.error ?? copy("catalog.purchase.addFailed"));
          return;
        }
        toast.success(copy("catalog.purchase.added"));
        // Re-renders the current route tree server-side, including the
        // layout's Suspense-wrapped cart-count badge — no separate cart
        // store to keep in sync (docs/PHASE_9_STOREFRONT_PLAN.md §11/§21).
        router.refresh();
      } catch {
        toast.error(copy("catalog.purchase.generalError"));
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PriceDisplay
        priceMinor={selectedVariant.priceMinor}
        compareAtPriceMinor={selectedVariant.compareAtPriceMinor}
        currency={selectedVariant.currency}
        size="lg"
      />

      {activeVariants.length > 1 ? (
        <Select
          value={selectedVariantId}
          onValueChange={(value) => {
            setSelectedVariantId(value ?? undefined);
            setQuantity(1);
          }}
        >
          <SelectTrigger
            aria-label={copy("catalog.purchase.variantAria")}
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {activeVariants.map((variant) => (
              <SelectItem key={variant.id} value={variant.id}>
                {variant.variantLabel ?? variant.sku}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {selectedVariant.status !== "ACTIVE"
          ? copy("catalog.purchase.currentlyUnavailable")
          : availableQuantity > 0
            ? copy("catalog.purchase.inStock")
            : copy("catalog.purchase.outOfStock")}
      </p>

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">
          {copy("catalog.purchase.quantity")}
        </span>
        <div className="flex items-center rounded-md border">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={copy("catalog.purchase.decrease")}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          >
            &minus;
          </Button>
          <span
            id="quantity"
            className="w-8 text-center text-sm"
            aria-live="polite"
          >
            {quantity}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={copy("catalog.purchase.increase")}
            disabled={
              availableQuantity <= 0 ||
              quantity >= Math.floor(availableQuantity)
            }
            onClick={() =>
              setQuantity((q) => Math.min(Math.floor(availableQuantity), q + 1))
            }
          >
            +
          </Button>
        </div>
      </div>

      <Button
        size="lg"
        disabled={
          isPending ||
          selectedVariant.status !== "ACTIVE" ||
          availableQuantity <= 0
        }
        onClick={handleAddToCart}
      >
        {isPending
          ? copy("catalog.purchase.adding")
          : copy("catalog.purchase.add")}
      </Button>
    </div>
  );
}
