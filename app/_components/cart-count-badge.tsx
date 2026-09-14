import { resolveCartActor } from "@/lib/cart-actor";
import { getCartItemCount } from "@/src/modules/cart/use-cases/get-cart-item-count";

/**
 * Genuinely dynamic (cookie-dependent) slice of the header — lives under
 * `app/` (not `components/`) specifically so it's allowed to call a
 * use-case directly (eslint boundaries forbid `components/**` from doing
 * so). Rendered inside a `<Suspense>` boundary by `app/layout.tsx` so it
 * never forces the surrounding cached shell to go fully dynamic
 * (docs/PHASE_9_STOREFRONT_PLAN.md §8).
 */
export async function CartCountBadge() {
  const actor = await resolveCartActor();
  const count = actor.type === "none" ? 0 : await getCartItemCount(actor);

  if (count === 0) {
    return null;
  }

  return (
    <span
      className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground"
      aria-label={`${count} item${count === 1 ? "" : "s"} in cart`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
