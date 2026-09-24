import Link from "next/link";

import { BrandLockup } from "@/components/brand/brand-lockup";
import { CartDrawer } from "@/components/storefront/cart-drawer";
import { MobileNav, type NavLink } from "@/components/storefront/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { copyValue, type SiteCopyDictionary } from "@/app/_data/site-copy";

export function SiteHeader({
  copy,
  cartSlot,
  accountSlot,
  mobileAccountSlot,
}: {
  copy: SiteCopyDictionary;
  cartSlot: React.ReactNode;
  accountSlot: React.ReactNode;
  mobileAccountSlot: React.ReactNode;
}) {
  const c = (key: string) => copyValue(copy, key);
  const links: NavLink[] = [
    {
      href: "/products",
      label: c("chrome.nav.shop.label"),
      description: c("chrome.nav.shop.description"),
    },
    {
      href: "/consultation",
      label: c("chrome.nav.consultation.label"),
      description: c("chrome.nav.consultation.description"),
    },
    {
      href: "/installation",
      label: c("chrome.nav.installation.label"),
      description: c("chrome.nav.installation.description"),
    },
  ];
  return (
    <header className="sticky top-0 z-40 border-b bg-background/92 backdrop-blur-xl supports-backdrop-filter:bg-background/78">
      <div className="page-shell flex h-16 items-center gap-4">
        <MobileNav links={links} accountSlot={mobileAccountSlot} />
        <Link href="/" aria-label={c("chrome.homeAria")} className="shrink-0">
          <BrandLockup siteName={c("site.name")} />
        </Link>
        <nav
          aria-label={c("chrome.mainNavAria")}
          className="ml-4 hidden items-center gap-1 md:flex"
        >
          {links.map((link) => (
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
          <ThemeToggle
            copy={{
              changeAria: c("chrome.theme.changeAria"),
              current: c("chrome.theme.current"),
              light: c("chrome.theme.light"),
              dark: c("chrome.theme.dark"),
              system: c("chrome.theme.system"),
            }}
          />
          <div className="hidden md:block">{accountSlot}</div>
          <CartDrawer countBadge={cartSlot} />
        </div>
      </div>
    </header>
  );
}
