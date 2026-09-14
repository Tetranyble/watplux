/**
 * Single source of truth for admin navigation — consumed by both the
 * desktop nav and the mobile drawer so they can never drift
 * (docs/PHASE_10_ADMIN_PLAN.md §8). `permission: null` means "always
 * shown to any authenticated admin/staff actor" (currently just
 * Dashboard). This list is display-only: hiding a link here is a
 * convenience, never the authorization boundary — every linked page
 * re-verifies the same permission (or stronger) itself.
 *
 * Audit Logs is deliberately NOT listed — that capability is deferred
 * (docs/PHASE_10_ADMIN_PLAN.md §28.2, approval Q1).
 */
export interface AdminNavLink {
  href: string;
  label: string;
  permission: string | null;
}

export const ADMIN_NAV_LINKS: AdminNavLink[] = [
  { href: "/admin", label: "Dashboard", permission: null },
  {
    href: "/admin/catalog/products",
    label: "Catalog",
    permission: "products.read",
  },
  {
    href: "/admin/inventory",
    label: "Inventory",
    permission: "inventory.read",
  },
  { href: "/admin/orders", label: "Orders", permission: "orders.read" },
  { href: "/admin/payments", label: "Payments", permission: "payments.read" },
  {
    href: "/admin/service-requests",
    label: "Services",
    permission: "consultations.read",
  },
  { href: "/admin/customers", label: "Customers", permission: "users.manage" },
];

export function visibleAdminNavLinks(
  permissions: ReadonlySet<string>,
): AdminNavLink[] {
  return ADMIN_NAV_LINKS.filter(
    (link) => link.permission === null || permissions.has(link.permission),
  );
}
