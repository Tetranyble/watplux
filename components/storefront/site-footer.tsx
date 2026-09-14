import Link from "next/link";
import { BrandLockup } from "@/components/brand/brand-lockup";
import { siteConfig } from "@/lib/site-config";

export function SiteFooter({ currentYear }: { currentYear: number }) {
  return (
    <footer className="mt-16 border-t bg-card/70">
      <div className="page-shell grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="max-w-sm">
          <BrandLockup />
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {siteConfig.description}
          </p>
        </div>
        <nav aria-label="Shop" className="flex flex-col gap-2.5 text-sm">
          <p className="font-semibold text-foreground">Shop</p>
          <Link
            href="/products"
            className="text-muted-foreground hover:text-primary"
          >
            All products
          </Link>
          <Link
            href="/cart"
            className="text-muted-foreground hover:text-primary"
          >
            Cart
          </Link>
        </nav>
        <nav aria-label="Services" className="flex flex-col gap-2.5 text-sm">
          <p className="font-semibold text-foreground">Services</p>
          <Link
            href="/consultation"
            className="text-muted-foreground hover:text-primary"
          >
            Solar consultation
          </Link>
          <Link
            href="/installation"
            className="text-muted-foreground hover:text-primary"
          >
            Installation
          </Link>
        </nav>
        <nav aria-label="Get help" className="flex flex-col gap-2.5 text-sm">
          <p className="font-semibold text-foreground">Get help</p>
          <Link
            href="/consultation"
            className="text-muted-foreground hover:text-primary"
          >
            Plan a system
          </Link>
          <Link
            href="/installation"
            className="text-muted-foreground hover:text-primary"
          >
            Request installation
          </Link>
          <Link
            href="/account/service-requests"
            className="text-muted-foreground hover:text-primary"
          >
            Track a request
          </Link>
        </nav>
      </div>
      <div className="border-t">
        <div className="page-shell flex flex-col gap-2 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {currentYear} {siteConfig.name}. All rights reserved.
          </p>
          <p>Reliable energy, designed around real needs.</p>
        </div>
      </div>
    </footer>
  );
}
