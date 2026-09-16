import Link from "next/link";
import {
  Boxes,
  ClipboardList,
  ExternalLink,
  Gauge,
  PackageSearch,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Users,
} from "lucide-react";

import { BrandMark } from "@/components/brand/brand-mark";
import { visibleAdminNavLinks } from "@/components/admin/admin-nav-links";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const ICONS = {
  "/admin": Gauge,
  "/admin/catalog/products": Boxes,
  "/admin/inventory": PackageSearch,
  "/admin/orders": ShoppingBag,
  "/admin/payments": ReceiptText,
  "/admin/service-requests": ClipboardList,
  "/admin/customers": Users,
} as const;

export function AdminSidebar({
  permissions,
  name,
  email,
  image,
  signOutSlot,
}: {
  permissions: ReadonlySet<string>;
  name: string;
  email: string;
  image: string | null;
  signOutSlot: React.ReactNode;
}) {
  const links = visibleAdminNavLinks(permissions);
  const identity = name.trim() || email.split("@")[0] || "User";
  const fallback = identity
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <aside className="hidden w-64 shrink-0 border-r bg-sidebar text-sidebar-foreground lg:block">
      <div className="sticky top-0 flex h-screen flex-col p-4">
        <Link href="/admin" className="flex items-center gap-3 rounded-2xl p-2">
          <BrandMark />
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Operations
          </span>
        </Link>
        <nav aria-label="Admin" className="mt-7 grid gap-1">
          {links.map((link) => {
            const Icon = ICONS[link.href as keyof typeof ICONS] ?? Gauge;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Icon className="size-4" aria-hidden="true" />
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-sidebar-border pt-4">
          <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="size-9 ring-1 ring-sidebar-border">
                {image ? <AvatarImage src={image} alt="" /> : null}
                <AvatarFallback>{fallback}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
                  {name || identity}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {email}
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-1">
              <Link
                href="/account"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Settings className="size-3.5" aria-hidden="true" />
                Account settings
              </Link>
              <Link
                href="/"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                View storefront
              </Link>
            </div>

            <div className="mt-3 flex items-center gap-2 border-t border-sidebar-border pt-3 text-[11px] text-muted-foreground">
              <ShieldCheck
                className="size-3.5 text-primary-emphasis"
                aria-hidden="true"
              />
              Secure operations session
            </div>
            <div className="mt-2">{signOutSlot}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
