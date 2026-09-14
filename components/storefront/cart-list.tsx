"use client";

import { useRouter } from "next/navigation";

import { CartLineItem } from "@/components/storefront/cart-line-item";
import type { CartItemRecord } from "@/src/modules/cart/types";

/**
 * Client wrapper only so a mutation can trigger `router.refresh()` —
 * re-running the Server Component tree (including this page's own
 * `getActiveCart` call) rather than keeping a separate, potentially
 * stale client-side copy of cart totals (docs/PHASE_9_STOREFRONT_PLAN.md
 * §11/§21: the server's response is always the source of truth).
 */
export function CartList({ items }: { items: CartItemRecord[] }) {
  const router = useRouter();
  return (
    <div className="rounded-lg border px-4">
      {items.map((item) => (
        <CartLineItem
          key={item.id}
          item={item}
          onChanged={() => router.refresh()}
        />
      ))}
    </div>
  );
}
