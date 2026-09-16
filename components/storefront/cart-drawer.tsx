"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, ShoppingCart } from "lucide-react";

import { CartLineItem } from "@/components/storefront/cart-line-item";
import { CartSummary } from "@/components/storefront/cart-summary";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
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
  const [error, setError] = useState<string | null>(null);

  async function loadCart() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cart");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? "Could not load your cart.");
      }
      setCart(body.cart ?? null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load your cart.",
      );
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
      <SheetContent
        side="right"
        className="w-[min(92vw,28rem)] gap-0 bg-background text-foreground"
      >
        <SheetHeader className="border-b px-4 py-4 pr-12">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <ShoppingCart className="size-4" aria-hidden="true" />
            </div>
            <div>
              <SheetTitle>Your cart</SheetTitle>
              <SheetDescription className="mt-0.5">
                {cart && cart.items.length > 0
                  ? `${cart.itemCount} item${cart.itemCount === 1 ? "" : "s"} ready to review`
                  : "Review items before checkout"}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {isLoading ? (
            <div className="grid gap-5 py-2" aria-label="Loading cart">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="mt-3 h-7 w-24" />
                  </div>
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
          ) : error ? (
            <EmptyState
              className="min-h-64 px-2"
              icon={AlertCircle}
              title="Couldn’t load your cart"
              description={error}
              action={
                <Button variant="outline" onClick={() => void loadCart()}>
                  Try again
                </Button>
              }
            />
          ) : !cart || cart.items.length === 0 ? (
            <EmptyState
              className="min-h-64 px-2 sm:min-h-80"
              icon={ShoppingCart}
              title="Your cart is empty"
              description="Add products to review them here before checkout."
              action={
                <Button
                  nativeButton={false}
                  render={
                    <Link href="/products" onClick={() => setOpen(false)} />
                  }
                >
                  Browse products
                </Button>
              }
            />
          ) : (
            <div>
              {cart.items.map((item) => (
                <CartLineItem key={item.id} item={item} onChanged={loadCart} />
              ))}
            </div>
          )}
        </div>
        {!isLoading && !error && cart && cart.items.length > 0 ? (
          <SheetFooter className="gap-2 border-t bg-muted/10 p-4">
            <CartSummary
              itemCount={cart.itemCount}
              subtotalDisplayMinor={cart.subtotalDisplayMinor}
              variant="drawer"
              onCheckout={() => setOpen(false)}
            />
            <Button
              variant="outline"
              className="w-full"
              nativeButton={false}
              render={<Link href="/cart" onClick={() => setOpen(false)} />}
            >
              View full cart
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
