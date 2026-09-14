"use client";

import Link from "next/link";
import { useState } from "react";
import { ShoppingCart } from "lucide-react";

import { CartLineItem } from "@/components/storefront/cart-line-item";
import { CartSummary } from "@/components/storefront/cart-summary";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { CartDetail } from "@/src/modules/cart/types";

/**
 * A quick-glance cart overlay — fetches the real `/api/cart` route itself
 * (a genuine client interaction, not a use-case import, so this stays a
 * plain presentational-boundary-safe component per the ESLint boundary
 * rules) rather than duplicating cart state. `/cart` (the full page,
 * `app/cart/page.tsx`) remains the authoritative, server-rendered source
 * — this drawer is a convenience view over the same backend, never a
 * second cart implementation (docs/PHASE_9_STOREFRONT_PLAN.md §11).
 */
export function CartDrawer({ countBadge }: { countBadge: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [cart, setCart] = useState<CartDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function loadCart() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/cart");
      const body = await res.json();
      setCart(body.cart ?? null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadCart();
      }}
    >
      <SheetTrigger
        render={<Button variant="ghost" size="icon" aria-label="View cart" />}
      >
        <span className="relative">
          <ShoppingCart aria-hidden="true" />
          {countBadge}
        </span>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Your cart</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : !cart || cart.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Your cart is empty.
            </p>
          ) : (
            <div className="rounded-lg border px-3">
              {cart.items.map((item) => (
                <CartLineItem key={item.id} item={item} onChanged={loadCart} />
              ))}
            </div>
          )}
        </div>
        {cart && cart.items.length > 0 ? (
          <div className="border-t p-4">
            <CartSummary
              itemCount={cart.itemCount}
              subtotalDisplayMinor={cart.subtotalDisplayMinor}
            />
            <Button
              variant="ghost"
              className="mt-2 w-full"
              nativeButton={false}
              render={<Link href="/cart" onClick={() => setOpen(false)} />}
            >
              View full cart
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
