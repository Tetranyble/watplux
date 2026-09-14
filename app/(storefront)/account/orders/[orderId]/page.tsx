import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { OrderActions } from "@/components/storefront/order-actions";
import { OrderStatusBadge } from "@/components/storefront/order-status-badge";
import { formatDate, formatMinorUnits } from "@/lib/format";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/order/schema";
import { getOrderById } from "@/src/modules/order/use-cases/get-order-by-id";

export const metadata: Metadata = {
  title: "Order detail",
};

export const instant = false;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const { orderId } = await params;
  const parsedOrderId = idParamSchema.safeParse(orderId);
  if (!parsedOrderId.success) {
    notFound();
  }

  let order;
  try {
    order = await getOrderById(user, parsedOrderId.data);
  } catch (error) {
    // A 403 (exists, but isn't yours) renders identically to a 404 — never
    // confirm to an attacker that a given order id exists at all
    // (docs/PHASE_9_STOREFRONT_PLAN.md §22, matching the existing Phase 6
    // IDOR convention this page just relies on, not reimplements).
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Order {order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">
            Placed {formatDate(order.createdAt)}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {order.status === "PENDING_PAYMENT" ? (
        <div className="mb-6">
          <OrderActions orderId={order.id} />
        </div>
      ) : null}

      <div className="mb-8 rounded-lg border">
        <table className="w-full text-sm">
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-b last:border-b-0">
                <td className="p-3">
                  <p className="font-medium">{item.productNameSnapshot}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.skuSnapshot}
                    {item.variantLabelSnapshot
                      ? ` — ${item.variantLabelSnapshot}`
                      : ""}
                  </p>
                </td>
                <td className="p-3 text-right text-muted-foreground">
                  {item.quantity} &times;{" "}
                  {formatMinorUnits(item.unitPriceMinor, order.currency)}
                </td>
                <td className="p-3 text-right font-medium">
                  {formatMinorUnits(item.lineTotalMinor, order.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-8 flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{formatMinorUnits(order.subtotalMinor, order.currency)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Delivery</span>
          <span>
            {formatMinorUnits(order.deliveryFeeMinor, order.currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tax</span>
          <span>{formatMinorUnits(order.taxMinor, order.currency)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
          <span>Total</span>
          <span>{formatMinorUnits(order.totalMinor, order.currency)}</span>
        </div>
      </div>

      {order.addresses.length > 0 ? (
        <div className="mb-8">
          <h2 className="mb-2 text-sm font-semibold">Shipping address</h2>
          {order.addresses
            .filter((address) => address.type === "SHIPPING")
            .map((address) => (
              <address
                key={address.id}
                className="text-sm text-muted-foreground not-italic"
              >
                {address.fullName}
                <br />
                {address.addressLine1}
                {address.addressLine2 ? <>, {address.addressLine2}</> : null}
                <br />
                {address.city}, {address.state}, {address.country}
                <br />
                {address.phone}
              </address>
            ))}
        </div>
      ) : null}

      {order.statusHistory.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Status history</h2>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {order.statusHistory.map((entry) => (
              <li key={entry.id}>
                {formatDate(entry.createdAt)}: {entry.fromStatus} &rarr;{" "}
                {entry.toStatus}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
