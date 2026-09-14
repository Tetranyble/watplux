import Link from "next/link";

import { cn } from "@/lib/utils";

const CATALOG_SUB_LINKS = [
  { href: "/admin/catalog/products", label: "Products" },
  { href: "/admin/catalog/categories", label: "Categories" },
  { href: "/admin/catalog/brands", label: "Brands" },
  { href: "/admin/catalog/media", label: "Media" },
] as const;

/** Local sub-navigation between the Catalog admin screens — the
 * top-level admin nav only links to Products (docs/PHASE_10_ADMIN_PLAN.md
 * §8); this is a page-level convenience, not a second authorization
 * boundary (every linked page independently enforces `products.read`). */
export function CatalogSubNav({ active }: { active: string }) {
  return (
    <nav className="flex gap-4 border-b pb-2 text-sm">
      {CATALOG_SUB_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "pb-2 text-muted-foreground hover:text-foreground",
            active === link.href &&
              "border-b-2 border-primary font-medium text-foreground",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
