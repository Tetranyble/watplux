import { StatCard } from "@/components/admin/stat-card";
import { OrderStatusBadge } from "@/components/storefront/order-status-badge";
import { formatMinorUnits } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import { getCustomerMetrics } from "@/src/modules/auth/use-cases/get-customer-metrics";
import { getProductCount } from "@/src/modules/catalog/use-cases/get-product-count";
import { getLowStockCount } from "@/src/modules/inventory/use-cases/get-low-stock-count";
import { getOrderMetrics } from "@/src/modules/order/use-cases/get-order-metrics";
import { getPaymentMetrics } from "@/src/modules/payment/use-cases/get-payment-metrics";

const NEW_CUSTOMER_WINDOW_DAYS = 30;

/** Pulled out of the component body — React's purity lint rule flags a
 * direct `Date.now()`/`new Date()` call inside a component's own render
 * function (even an async Server Component) as an impure call, per
 * https://react.dev/reference/rules/components-and-hooks-must-be-pure. */
function getNewCustomerWindowStart(): Date {
  return new Date(Date.now() - NEW_CUSTOMER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Read-only (docs/PHASE_10_ADMIN_PLAN.md §7 — "the dashboard is
 * read-only. Do not create mutation logic here"). Every metric section
 * is gated on the SAME permission its own use-case independently
 * enforces — this page checks first only to avoid an unnecessary
 * `ForbiddenError` throw/catch for an actor who structurally can't hold
 * that permission's data (e.g. `staff` never sees a customer-metrics
 * query attempted at all), never as the actual security boundary (each
 * `get*Metrics` use-case still calls its own `requirePermission`
 * regardless of whether this page calls it).
 *
 * Every read is a plain, uncached, dynamic query (§16/§24 — admin pages
 * never use `"use cache"`) — a handful of indexed `count`/`sum`/`groupBy`
 * calls, not an aggregate expensive enough to justify caching an
 * RBAC-sensitive number before real measurement says otherwise.
 */
export default async function AdminDashboardPage() {
  const actor = await getSessionUser();
  // The layout already redirects if there's no session; this satisfies
  // TypeScript's narrowing without re-implementing that check here.
  if (!actor) return null;

  const canReadOrders = actor.permissions.has("orders.read");
  const canReadPayments = actor.permissions.has("payments.read");
  const canReadInventory = actor.permissions.has("inventory.read");
  const canReadProducts = actor.permissions.has("products.read");
  const canManageUsers = actor.permissions.has("users.manage");

  const [
    orderMetrics,
    paymentMetrics,
    lowStockCount,
    productCount,
    customerMetrics,
  ] = await Promise.all([
    canReadOrders ? getOrderMetrics(actor) : Promise.resolve(null),
    canReadPayments ? getPaymentMetrics(actor) : Promise.resolve(null),
    canReadInventory ? getLowStockCount(actor) : Promise.resolve(null),
    canReadProducts ? getProductCount(actor) : Promise.resolve(null),
    canManageUsers
      ? getCustomerMetrics(actor, getNewCustomerWindowStart())
      : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {orderMetrics ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Orders
          </h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="Total orders"
              value={String(orderMetrics.totalOrders)}
            />
            <StatCard
              label="Paid revenue"
              value={formatMinorUnits(orderMetrics.paidRevenueMinor, "NGN")}
              hint="PAID and later statuses, all-time"
            />
            {paymentMetrics ? (
              <>
                <StatCard
                  label="Pending payments"
                  value={String(paymentMetrics.pendingPayments)}
                />
                <StatCard
                  label="Failed attempts"
                  value={String(paymentMetrics.failedAttempts)}
                />
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              Object.entries(orderMetrics.ordersByStatus) as [
                keyof typeof orderMetrics.ordersByStatus,
                number,
              ][]
            )
              .filter(([, count]) => count > 0)
              .map(([status, count]) => (
                <div
                  key={status}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <OrderStatusBadge status={status} />
                  <span className="font-medium">{count}</span>
                </div>
              ))}
          </div>
        </section>
      ) : null}

      {paymentMetrics ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Payments
          </h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="Refunded amount"
              value={formatMinorUnits(
                paymentMetrics.refundedAmountMinor,
                "NGN",
              )}
            />
          </div>
        </section>
      ) : null}

      {lowStockCount !== null || productCount !== null ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Catalog &amp; inventory
          </h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {productCount !== null ? (
              <StatCard label="Active products" value={String(productCount)} />
            ) : null}
            {lowStockCount !== null ? (
              <StatCard label="Low-stock items" value={String(lowStockCount)} />
            ) : null}
          </div>
        </section>
      ) : null}

      {customerMetrics ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Customers
          </h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="Active customers"
              value={String(customerMetrics.activeCustomers)}
            />
            <StatCard
              label="New customers"
              value={String(customerMetrics.newCustomers)}
              hint={`Last ${NEW_CUSTOMER_WINDOW_DAYS} days`}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
