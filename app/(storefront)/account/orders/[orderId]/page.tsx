import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { OrderActions } from "@/components/storefront/order-actions";
import { OrderStatusBadge } from "@/components/storefront/order-status-badge";
import { formatDate, formatMinorUnits } from "@/lib/format";
import { isForbiddenError, isNotFoundError } from "@/lib/errors";
import { getSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/order/schema";
import { getOrderById } from "@/src/modules/order/use-cases/get-order-by-id";
import { copyValue, getSiteCopy, interpolateCopy } from "@/app/_data/site-copy";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();
  return { title: copyValue(copy, "account.order.metaTitle") };
}

export const instant = false;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const [user, copy] = await Promise.all([getSessionUser(), getSiteCopy()]);
  if (!user) {
    redirect("/login");
  }
  const c = (key: string) => copyValue(copy, key);

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
    if (isNotFoundError(error) || isForbiddenError(error)) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="page-shell py-8 sm:py-10">
      <div className="max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {interpolateCopy(c("account.order.heading"), {
                number: order.orderNumber,
              })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {interpolateCopy(c("account.order.placed"), {
                date: formatDate(order.createdAt),
              })}
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
            <span className="text-muted-foreground">
              {c("account.order.subtotal")}
            </span>
            <span>{formatMinorUnits(order.subtotalMinor, order.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {c("account.order.delivery")}
            </span>
            <span>
              {formatMinorUnits(order.deliveryFeeMinor, order.currency)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {c("account.order.tax")}
            </span>
            <span>{formatMinorUnits(order.taxMinor, order.currency)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
            <span>{c("account.order.total")}</span>
            <span>{formatMinorUnits(order.totalMinor, order.currency)}</span>
          </div>
        </div>

        {order.addresses.length > 0 ? (
          <div className="mb-8">
            <h2 className="mb-2 text-sm font-semibold">
              {c("account.order.shipping")}
            </h2>
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
            <h2 className="mb-2 text-sm font-semibold">
              {c("account.order.history")}
            </h2>
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
    </div>
  );
}
