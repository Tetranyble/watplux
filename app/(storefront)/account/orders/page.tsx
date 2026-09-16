import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ShoppingBag } from "lucide-react";

import { OrderStatusBadge } from "@/components/storefront/order-status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
import { listMyOrders } from "@/src/modules/order/use-cases/list-my-orders";

export const metadata: Metadata = {
  title: "Your orders",
};

// Session-cookie-dependent — the real security boundary is this page's
// own `getSessionUser()` call, not `proxy.ts` (see app/account/page.tsx).
export const instant = false;

export default async function OrdersPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const page = await listMyOrders(user, { limit: 20 });

  if (page.items.length === 0) {
    return (
      <div className="page-shell flex flex-1">
        <EmptyState
          icon={ShoppingBag}
          title="You haven’t placed an order yet"
          description="Your purchases and delivery progress will appear here after checkout."
          action={
            <Button nativeButton={false} render={<Link href="/products" />}>
              Browse products
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="page-shell py-8 sm:py-10">
      <h1 className="mb-6 text-2xl font-semibold">Your orders</h1>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  <Link
                    href={`/account/orders/${order.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {order.orderNumber}
                  </Link>
                </TableCell>
                <TableCell>{formatDate(order.createdAt)}</TableCell>
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
    </div>
  );
}
