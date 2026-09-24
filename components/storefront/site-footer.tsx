import Link from "next/link";
import { BrandLockup } from "@/components/brand/brand-lockup";
import {
  copyValue,
  interpolateCopy,
  type SiteCopyDictionary,
} from "@/app/_data/site-copy";

export function SiteFooter({
  currentYear,
  copy,
}: {
  currentYear: number;
  copy: SiteCopyDictionary;
}) {
  const c = (key: string) => copyValue(copy, key);
  return (
    <footer className="mt-16 border-t bg-card/70">
      <div className="page-shell grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="max-w-sm">
          <BrandLockup siteName={c("site.name")} />
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {c("site.description")}
          </p>
        </div>
        <nav
          aria-label={c("chrome.footer.shop.aria")}
          className="flex flex-col gap-2.5 text-sm"
        >
          <p className="font-semibold text-foreground">
            {c("chrome.footer.shop.heading")}
          </p>
          <Link
            href="/products"
            className="text-muted-foreground hover:text-primary-emphasis"
          >
            {c("chrome.footer.allProducts")}
          </Link>
          <Link
            href="/cart"
            className="text-muted-foreground hover:text-primary-emphasis"
          >
            {c("chrome.footer.cart")}
          </Link>
        </nav>
        <nav
          aria-label={c("chrome.footer.services.aria")}
          className="flex flex-col gap-2.5 text-sm"
        >
          <p className="font-semibold text-foreground">
            {c("chrome.footer.services.heading")}
          </p>
          <Link
            href="/consultation"
            className="text-muted-foreground hover:text-primary-emphasis"
          >
            {c("chrome.footer.consultation")}
          </Link>
          <Link
            href="/installation"
            className="text-muted-foreground hover:text-primary-emphasis"
          >
            {c("chrome.footer.installation")}
          </Link>
        </nav>
        <nav
          aria-label={c("chrome.footer.help.aria")}
          className="flex flex-col gap-2.5 text-sm"
        >
          <p className="font-semibold text-foreground">
            {c("chrome.footer.help.heading")}
          </p>
          <Link
            href="/consultation"
            className="text-muted-foreground hover:text-primary-emphasis"
          >
            {c("chrome.footer.plan")}
          </Link>
          <Link
            href="/installation"
            className="text-muted-foreground hover:text-primary-emphasis"
          >
            {c("chrome.footer.requestInstallation")}
          </Link>
          <Link
            href="/account/service-requests"
            className="text-muted-foreground hover:text-primary-emphasis"
          >
            {c("chrome.footer.trackRequest")}
          </Link>
        </nav>
      </div>
      <div className="border-t">
        <div className="page-shell flex flex-col gap-2 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            {interpolateCopy(c("chrome.footer.copyright"), {
              currentYear,
              year: currentYear,
              siteName: c("site.name"),
            })}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:justify-end">
            <p>{c("chrome.footer.tagline")}</p>
            <span aria-hidden="true" className="hidden sm:inline">
              ·
            </span>
            <p>
              {c("chrome.footer.creditPrefix")}{" "}
              <a
                href="https://tetranyble.com"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline-offset-4 transition-colors hover:text-primary-emphasis hover:underline"
              >
                {c("chrome.footer.creditName")}
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
