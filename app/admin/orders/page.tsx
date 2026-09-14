import Link from "next/link";
import type { Metadata } from "next";

import { OrderFilterForm } from "@/components/admin/order-filter-form";
import { OrderStatusBadge } from "@/components/storefront/order-status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMinorUnits } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import type { ListOrdersForAdminInput } from "@/src/modules/order/schema";
import type { OrderSummary } from "@/src/modules/order/types";
import { listOrdersForAdmin } from "@/src/modules/order/use-cases/list-orders-for-admin";

export const metadata: Metadata = { title: "Orders" };

// Reads `searchParams` (filters/cursor) and the session — inherently
// per-request, same as app/(storefront)/products/page.tsx.
export const instant = false;

const ORDER_STATUSES = new Set<OrderSummary["status"]>([
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "READY_FOR_DISPATCH",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);

function parseOrderStatus(
  value: string | undefined,
): OrderSummary["status"] | undefined {
  return value && ORDER_STATUSES.has(value as OrderSummary["status"])
    ? (value as OrderSummary["status"])
    : undefined;
}

/** `<input type="date">` posts a bare `YYYY-MM-DD` — anchored to UTC
 * day-start/day-end so the range is inclusive of the whole selected day
 * regardless of server timezone. An unparseable value is silently
 * dropped rather than crashing the page (matches
 * app/(storefront)/products/page.tsx's `parsePositiveInt` convention of
 * ignoring malformed filter input instead of erroring). */
function parseDateFrom(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseDateTo(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * `orders.read`, enforced inside `listOrdersForAdmin` itself
 * (docs/PHASE_10_ADMIN_PLAN.md §8) — this page never checks the
 * permission itself; a staff/customer actor lacking `orders.read` who
 * navigates here directly gets a thrown `ForbiddenError`, surfaced by
 * the root `app/error.tsx` boundary, not a fabricated empty list.
 *
 * The customer column intentionally shows only `guestEmail` (present for
 * guest checkouts) or a link to the customer's detail page — resolving a
 * *registered* customer's email inline in a list is the explicitly
 * deferred "customer list" capability (approval Q3); this list never
 * needs it since `OrderSummary` already carries `userId`.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getSessionUser();
  if (!actor) return null;

  const rawParams = await searchParams;
  const get = (key: string): string | undefined => {
    const value = rawParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const filters: ListOrdersForAdminInput = {
    limit: 20,
    status: parseOrderStatus(get("status")),
    dateFrom: parseDateFrom(get("dateFrom")),
    dateTo: parseDateTo(get("dateTo")),
    orderNumber: get("orderNumber")?.trim() || undefined,
    customerEmail: get("customerEmail")?.trim() || undefined,
    cursor: get("cursor"),
  };

  const page = await listOrdersForAdmin(actor, filters);

  const nextPageParams = new URLSearchParams(
    Object.entries(rawParams).flatMap(([key, value]) =>
      value === undefined || key === "cursor" ? [] : [[key, String(value)]],
    ),
  );
  if (page.nextCursor) {
    nextPageParams.set("cursor", page.nextCursor);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Orders</h1>

      <OrderFilterForm
        values={{
          status: get("status"),
          dateFrom: get("dateFrom"),
          dateTo: get("dateTo"),
          orderNumber: get("orderNumber"),
          customerEmail: get("customerEmail"),
        }}
      />

      {page.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No orders match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(order.createdAt)}</TableCell>
                  <TableCell>
                    {order.guestEmail ? (
                      order.guestEmail
                    ) : order.userId ? (
                      <Link
                        href={`/admin/customers/${order.userId}`}
                        className="underline-offset-2 hover:underline"
                      >
                        View customer
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <OrderStatusBadge status={order.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMinorUnits(order.totalMinor, order.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {page.nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link href={`/admin/orders?${nextPageParams.toString()}`} />
            }
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
