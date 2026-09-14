/** Already-seeded permissions (`prisma/seed-data.ts`) — no new permission
 * keys are introduced by this module (docs/PHASE_6_ORDER_PLAN.md §16). */
export const PERMISSION_ORDERS_READ = "orders.read";
export const PERMISSION_ORDERS_UPDATE = "orders.update";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** `order_items.quantity` is `DECIMAL(12,3)`, matching Inventory's exact
 * quantity precision. */
export const QUANTITY_DECIMAL_PLACES = 3;

export const ORDER_ADDRESS_TYPE_SHIPPING = "SHIPPING";
export const ORDER_ADDRESS_TYPE_BILLING = "BILLING";
