import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CreditCard } from "lucide-react";

import { RequestRefundForm } from "@/components/admin/refund-actions";
import { OrderActions } from "@/components/storefront/order-actions";
import { OrderStatusBadge } from "@/components/storefront/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { isNotFoundError } from "@/lib/errors";
import { formatDate, formatMinorUnits } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import { PERMISSION_ORDERS_UPDATE } from "@/src/modules/order/constants";
import { idParamSchema } from "@/src/modules/order/schema";
import { getOrderForAdmin } from "@/src/modules/order/use-cases/get-order-for-admin";
import {
  PERMISSION_PAYMENTS_READ,
  PERMISSION_PAYMENTS_REFUND,
} from "@/src/modules/payment/constants";
import { listPaymentAttemptsForOrder } from "@/src/modules/payment/use-cases/list-payment-attempts-for-order";

export const metadata: Metadata = { title: "Order detail" };

export const instant = false;

/**
 * `orders.read`, enforced inside `getOrderForAdmin` (docs/PHASE_10_ADMIN_PLAN.md
 * §8). Unlike the customer-facing detail page
 * (app/(storefront)/account/orders/[orderId]/page.tsx), a `ForbiddenError`
 * here is NOT caught and hidden behind `notFound()` — that IDOR-hiding
 * posture exists to avoid confirming a *stranger's* order exists; an
 * admin actor has no ownership dimension at all, so lacking `orders.read`
 * entirely is a real authorization failure, correctly surfaced as an
 * error rather than disguised as a 404. Only a genuine `NotFoundError`
 * (the order id doesn't exist) renders `not-found.tsx`.
 *
 * Payment attempts are shown only if the actor also holds `payments.read`
 * — a second, independent permission from `orders.read` — matching the
 * dashboard's per-metric permission-gating discipline
 * (docs/PHASE_10_ADMIN_PLAN.md §7).
 */
export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) return null;

  const { orderId } = await params;
  const parsedOrderId = idParamSchema.safeParse(orderId);
  if (!parsedOrderId.success) {
    notFound();
  }

  let order;
  try {
    order = await getOrderForAdmin(actor, parsedOrderId.data);
  } catch (error) {
    if (isNotFoundError(error)) {
      notFound();
    }
    throw error;
  }

  const canReadPayments = actor.permissions.has(PERMISSION_PAYMENTS_READ);
  const paymentAttempts = canReadPayments
    ? await listPaymentAttemptsForOrder(actor, parsedOrderId.data)
    : null;

  const canUpdateOrders = actor.permissions.has(PERMISSION_ORDERS_UPDATE);
  const canRefund = actor.permissions.has(PERMISSION_PAYMENTS_REFUND);
  const shippingAddress = order.addresses.find((a) => a.type === "SHIPPING");
  const billingAddress = order.addresses.find((a) => a.type === "BILLING");

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Order {order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">
            Placed {formatDate(order.createdAt)}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* Cancel/retry hit the existing /api/orders/[orderId]/* routes,
          which already grant access to any admin/staff holding
          `orders.update` via their existing ownership-OR-permission
          branch — no admin-specific route needed
          (docs/PHASE_10_ADMIN_PLAN.md §8). Gated on `orders.update` here
          purely for display; the routes re-verify regardless. */}
      {canUpdateOrders && order.status === "PENDING_PAYMENT" ? (
        <OrderActions orderId={order.id} />
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Items</h2>
        <div className="rounded-lg border">
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
        <div className="flex flex-col gap-1 text-sm">
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
      </section>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Customer
          </h2>
          <p className="text-sm">
            {order.guestEmail
              ? order.guestEmail
              : order.userId
                ? `Registered customer (user #${order.userId})`
                : "—"}
          </p>
          {order.guestPhone ? (
            <p className="text-sm text-muted-foreground">{order.guestPhone}</p>
          ) : null}
        </div>

        {shippingAddress ? (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              Shipping address
            </h2>
            <address className="text-sm text-muted-foreground not-italic">
              {shippingAddress.fullName}
              <br />
              {shippingAddress.addressLine1}
              {shippingAddress.addressLine2
                ? `, ${shippingAddress.addressLine2}`
                : ""}
              <br />
              {shippingAddress.city}, {shippingAddress.state},{" "}
              {shippingAddress.country}
              <br />
              {shippingAddress.phone}
            </address>
          </div>
        ) : null}

        {billingAddress ? (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              Billing address
            </h2>
            <address className="text-sm text-muted-foreground not-italic">
              {billingAddress.fullName}
              <br />
              {billingAddress.addressLine1}
              {billingAddress.addressLine2
                ? `, ${billingAddress.addressLine2}`
                : ""}
              <br />
              {billingAddress.city}, {billingAddress.state},{" "}
              {billingAddress.country}
              <br />
              {billingAddress.phone}
            </address>
          </div>
        ) : null}
      </section>

      {order.statusHistory.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Status history
          </h2>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {order.statusHistory.map((entry) => (
              <li key={entry.id}>
                {formatDate(entry.createdAt)}: {entry.fromStatus} &rarr;{" "}
                {entry.toStatus}
                {entry.note ? ` — ${entry.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {paymentAttempts ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Payment attempts
          </h2>
          {paymentAttempts.length === 0 ? (
            <EmptyState
              className="min-h-40 py-8"
              icon={CreditCard}
              title="No payment attempts yet"
              description="Payment activity for this order will appear here."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {paymentAttempts.map((attempt) => (
                <li
                  key={attempt.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{attempt.paystackReference}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(attempt.createdAt)}
                      {attempt.channel ? ` · ${attempt.channel}` : ""}
                    </p>
                    {attempt.errorMessage ? (
                      <p className="text-xs text-destructive">
                        {attempt.errorMessage}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {formatMinorUnits(
                          attempt.amountMinor,
                          attempt.currency,
                        )}
                      </span>
                      <Badge variant="outline">{attempt.status}</Badge>
                      {order.authoritativePaymentAttemptId === attempt.id ? (
                        <Badge variant="secondary">Authoritative</Badge>
                      ) : null}
                    </div>
                    {/* `requestRefund` hits the existing
                        `/api/admin/payments/[paymentAttemptId]/refunds`
                        route — surfaced here since a refund is always
                        requested against one specific SUCCESS attempt
                        (docs/PHASE_10_ADMIN_PLAN.md §14: "requestRefund/
                        cancelRefund may be surfaced where already
                        authorized"). Gated on `payments.refund` purely
                        for display; the route re-verifies regardless. */}
                    {canRefund &&
                    attempt.status === "SUCCESS" &&
                    attempt.availableRefundableAmountMinor !== null &&
                    attempt.availableRefundableAmountMinor > 0 ? (
                      <RequestRefundForm paymentAttemptId={attempt.id} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
