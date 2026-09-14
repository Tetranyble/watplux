import Link from "next/link";
import {
  Boxes,
  ClipboardList,
  Gauge,
  PackageSearch,
  ReceiptText,
  ShoppingBag,
  Users,
} from "lucide-react";

import { BrandMark } from "@/components/brand/brand-mark";
import { visibleAdminNavLinks } from "@/components/admin/admin-nav-links";

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
}: {
  permissions: ReadonlySet<string>;
}) {
  const links = visibleAdminNavLinks(permissions);
  return (
    <aside className="hidden w-64 shrink-0 border-r bg-sidebar text-sidebar-foreground lg:block">
      <div className="sticky top-0 flex h-screen flex-col p-4">
        <Link href="/admin" className="flex items-center gap-3 rounded-2xl p-2">
          <BrandMark />
          <span>
            <span className="block text-sm font-bold tracking-tight">
              Watplux
            </span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Operations
            </span>
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
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-background/70 p-4 text-xs leading-5 text-muted-foreground">
          <span className="mb-1 block font-semibold text-foreground">
            Protected operations
          </span>
          Every action is re-authorized by the server-side domain use-case.
        </div>
      </div>
    </aside>
  );
}
