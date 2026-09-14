import Link from "next/link";
import type { Metadata } from "next";

import { RefundFilterForm } from "@/components/admin/refund-filter-form";
import { CancelRefundButton } from "@/components/admin/refund-actions";
import { Badge } from "@/components/ui/badge";
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
import {
  DEFAULT_CURRENCY,
  PERMISSION_PAYMENTS_REFUND,
} from "@/src/modules/payment/constants";
import type { ListRefundsForAdminInput } from "@/src/modules/payment/schema";
import type { RefundRecord } from "@/src/modules/payment/types";
import { listRefundsForAdmin } from "@/src/modules/payment/use-cases/list-refunds-for-admin";

export const metadata: Metadata = { title: "Refunds" };

export const instant = false;

const REFUND_STATUSES = new Set<RefundRecord["status"]>([
  "REFUND_REQUESTED",
  "REFUND_PENDING",
  "REFUNDED",
  "REFUND_FAILED",
  "REFUND_CANCELLED",
]);

function parseRefundStatus(
  value: string | undefined,
): RefundRecord["status"] | undefined {
  return value && REFUND_STATUSES.has(value as RefundRecord["status"])
    ? (value as RefundRecord["status"])
    : undefined;
}

const CANCELLABLE_STATUSES: ReadonlySet<RefundRecord["status"]> = new Set([
  "REFUND_REQUESTED",
  "REFUND_PENDING",
]);

/**
 * `payments.read`, enforced inside `listRefundsForAdmin` itself — the
 * Phase 10 additive admin-wide refund read
 * (docs/PHASE_10_ADMIN_PLAN.md §14/§28.6). No manual PAID/REFUNDED
 * transition is offered anywhere on this screen; the only mutation is
 * `cancelRefund`, itself gated on `payments.refund` server-side.
 */
export default async function AdminRefundsPage({
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

  const status = parseRefundStatus(get("status"));
  const cursor = get("cursor");

  const filters: ListRefundsForAdminInput = { limit: 20, status, cursor };
  const page = await listRefundsForAdmin(actor, filters);

  const canCancel = actor.permissions.has(PERMISSION_PAYMENTS_REFUND);

  const nextPageParams = new URLSearchParams();
  if (get("status")) nextPageParams.set("status", get("status")!);
  if (page.nextCursor) nextPageParams.set("cursor", page.nextCursor);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Refunds</h1>
        <Link
          href="/admin/payments"
          className="text-sm underline-offset-2 hover:underline"
        >
          &larr; Reconciliation overview
        </Link>
      </div>

      <RefundFilterForm status={get("status")} />

      {page.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No refunds match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Processed</TableHead>
                {canCancel ? <TableHead>Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((refund) => (
                <TableRow key={refund.id}>
                  <TableCell>
                    <Link
                      href={`/admin/orders/${refund.orderId}`}
                      className="underline-offset-2 hover:underline"
                    >
                      Order #{refund.orderId}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMinorUnits(refund.amountMinor, DEFAULT_CURRENCY)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{refund.status}</Badge>
                  </TableCell>
                  <TableCell>{formatDate(refund.requestedAt)}</TableCell>
                  <TableCell>
                    {refund.processedAt ? formatDate(refund.processedAt) : "—"}
                  </TableCell>
                  {canCancel ? (
                    <TableCell>
                      {CANCELLABLE_STATUSES.has(refund.status) ? (
                        <CancelRefundButton refundId={refund.id} />
                      ) : null}
                    </TableCell>
                  ) : null}
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
              <Link
                href={`/admin/payments/refunds?${nextPageParams.toString()}`}
              />
            }
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
