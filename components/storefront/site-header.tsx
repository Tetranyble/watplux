import Link from "next/link";

import { BrandLockup } from "@/components/brand/brand-lockup";
import { CartDrawer } from "@/components/storefront/cart-drawer";
import { MobileNav, type NavLink } from "@/components/storefront/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV_LINKS: NavLink[] = [
  { href: "/products", label: "Shop" },
  { href: "/consultation", label: "Consultation" },
  { href: "/installation", label: "Installation" },
];

export function SiteHeader({
  cartSlot,
  accountSlot,
}: {
  cartSlot: React.ReactNode;
  accountSlot: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/92 backdrop-blur-xl supports-backdrop-filter:bg-background/78">
      <div className="page-shell flex h-16 items-center gap-4">
        <MobileNav links={NAV_LINKS} accountSlot={accountSlot} />
        <Link href="/" aria-label="Watplux home" className="shrink-0">
          <BrandLockup />
        </Link>
        <nav
          aria-label="Main"
          className="ml-4 hidden items-center gap-1 md:flex"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <div className="hidden md:block">{accountSlot}</div>
          <CartDrawer countBadge={cartSlot} />
        </div>
      </div>
    </header>
  );
}
