import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, CreditCard } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { listReconciliationFlags } from "@/src/modules/payment/use-cases/list-reconciliation-flags";
import type { PaymentAttemptRecord } from "@/src/modules/payment/types";

export const metadata: Metadata = { title: "Payments" };

export const instant = false;

function AttemptTable({ attempts }: { attempts: PaymentAttemptRecord[] }) {
  if (attempts.length === 0) {
    return (
      <EmptyState
        className="min-h-36 py-6"
        icon={CreditCard}
        title="No attempts to review"
        description="No payment attempts currently match this reconciliation check."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Reference</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {attempts.map((attempt) => (
            <TableRow key={attempt.id}>
              <TableCell className="font-mono text-xs">
                {attempt.paystackReference}
              </TableCell>
              <TableCell>
                <Link
                  href={`/admin/orders/${attempt.orderId}`}
                  className="underline-offset-2 hover:underline"
                >
                  Order #{attempt.orderId}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{attempt.status}</Badge>
              </TableCell>
              <TableCell className="text-right">
                {formatMinorUnits(attempt.amountMinor, attempt.currency)}
              </TableCell>
              <TableCell>{formatDate(attempt.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * `payments.read`, enforced inside `listReconciliationFlags` itself
 * (docs/PHASE_10_ADMIN_PLAN.md §14). Every field shown already exists on
 * `PaymentAttemptRecord` — no raw webhook payload, no Paystack secret,
 * no raw credentials are ever rendered. This screen is read-only: no
 * manual PAID/REFUNDED transition of any kind is offered here — every
 * status shown came from the state machine's own transitions.
 *
 * `stuckOrFailedWebhookEventIds`/`stuckRefundIds` are bare ID strings on
 * `ReconciliationFlags` (not hydrated records) — shown as a plain list of
 * IDs rather than fetching per-item detail, since no admin-facing
 * "webhook event detail" read exists and building one is out of scope.
 */
export default async function AdminPaymentsPage() {
  const actor = await getSessionUser();
  if (!actor) return null;

  const flags = await listReconciliationFlags(actor);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Payments</h1>
        <Link
          href="/admin/payments/refunds"
          className="text-sm underline-offset-2 hover:underline"
        >
          Refund queue &rarr;
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Non-authoritative successful attempts
        </h2>
        <p className="text-xs text-muted-foreground">
          Successful payments that are not (or no longer) their order&apos;s
          authoritative attempt — a possible double payment or a late payment
          after cancellation.
        </p>
        <AttemptTable attempts={flags.nonAuthoritativeSuccessfulAttempts} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Stuck initiated attempts
        </h2>
        <p className="text-xs text-muted-foreground">
          Attempts still in an unresolved &quot;initiated&quot; state past 30
          minutes — the initialize call may have crashed mid-flight.
        </p>
        <AttemptTable attempts={flags.stuckInitiatedAttempts} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Stuck or failed webhook events
        </h2>
        {flags.stuckOrFailedWebhookEventIds.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-primary-emphasis" />
            No stuck or failed webhook events.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {flags.stuckOrFailedWebhookEventIds.map((id) => (
              <li key={id}>
                <Badge variant="destructive">Event #{id}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Stuck refunds
        </h2>
        {flags.stuckRefundIds.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-primary-emphasis" />
            No stuck refunds.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {flags.stuckRefundIds.map((id) => (
              <li key={id}>
                <Badge variant="destructive">Refund #{id}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
