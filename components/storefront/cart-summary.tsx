"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { PriceDisplay } from "@/components/storefront/price-display";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";
import { interpolateCopy } from "@/src/modules/site-copy/copy";

export function CartSummary({
  itemCount,
  subtotalDisplayMinor,
  checkoutHref = "/checkout",
  showCheckoutButton = true,
  variant = "default",
  onCheckout,
}: {
  itemCount: number;
  subtotalDisplayMinor: number;
  checkoutHref?: string;
  showCheckoutButton?: boolean;
  variant?: "default" | "drawer";
  onCheckout?: () => void;
}) {
  const copy = useSiteCopy();
  return (
    <aside
      className={cn(
        "flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm",
        variant === "drawer" &&
          "gap-3 rounded-none border-0 bg-transparent p-0 shadow-none",
      )}
    >
      <div>
        <p className="text-sm font-semibold">
          {copy("commerce.summary.title")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {interpolateCopy(copy("commerce.summary.items"), {
            count: itemCount,
            itemLabel: copy(
              itemCount === 1
                ? "commerce.cart.itemSingular"
                : "commerce.cart.itemPlural",
            ),
          })}
        </p>
      </div>
      <div className="flex items-center justify-between border-y py-4 text-sm">
        <span className="text-muted-foreground">
          {copy("commerce.summary.subtotal")}
        </span>
        <PriceDisplay
          priceMinor={subtotalDisplayMinor}
          compareAtPriceMinor={null}
          currency="NGN"
        />
      </div>
      <div className="flex gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary-emphasis" />
        <p>{copy("commerce.summary.note")}</p>
      </div>
      {showCheckoutButton ? (
        <Button
          size="lg"
          nativeButton={false}
          render={<Link href={checkoutHref} onClick={onCheckout} />}
        >
          {copy("commerce.summary.checkout")}
        </Button>
      ) : null}
    </aside>
  );
}
