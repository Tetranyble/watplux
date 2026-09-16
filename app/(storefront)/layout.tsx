import { Suspense } from "react";

import { AccountNavArea } from "@/app/_components/account-nav-area";
import { CartCountBadge } from "@/app/_components/cart-count-badge";
import { getCachedCurrentYear } from "@/app/_data/misc";
import { SiteFooter } from "@/components/storefront/site-footer";
import { SiteHeader } from "@/components/storefront/site-header";

/**
 * The storefront's own chrome — moved out of the true root layout
 * (`app/layout.tsx`) so `/admin/**` (a sibling top-level segment, not
 * nested under this group) never inherits it
 * (docs/PHASE_10_ADMIN_PLAN.md §5). Every existing storefront route
 * (`/`, `/products`, `/cart`, `/checkout`, `/account`, `/login`, etc.)
 * moved into `app/(storefront)/` as a pure file relocation — the route
 * group segment never appears in the URL, so no existing link, redirect,
 * or test changes.
 */
export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentYear = await getCachedCurrentYear();
  return (
    <>
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only"
      >
        Skip to main content
      </a>
      {/*
        The header composes two genuinely dynamic, cookie-dependent
        slices (cart count, account state). Each is wrapped in its own
        <Suspense> boundary so the rest of every page's cached shell
        (docs/PHASE_9_STOREFRONT_PLAN.md §8) can still be statically
        prerendered — only these two slices stream in per-request.
      */}
      <SiteHeader
        cartSlot={
          <Suspense fallback={null}>
            <CartCountBadge />
          </Suspense>
        }
        accountSlot={
          <Suspense fallback={<span className="inline-block size-8" />}>
            <AccountNavArea />
          </Suspense>
        }
        mobileAccountSlot={
          <Suspense
            fallback={<div className="h-28 animate-pulse bg-muted/50" />}
          >
            <AccountNavArea variant="mobile" />
          </Suspense>
        }
      />
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter currentYear={currentYear} />
    </>
  );
}
