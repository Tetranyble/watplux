"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { PaymentAttemptRecord } from "@/src/modules/payment/types";

/**
 * The one authoritative source of truth for this screen: repeated calls
 * to `GET /api/orders/[orderId]/payment-attempts` (docs/PHASE_9_STOREFRONT_PLAN.md
 * §13). Paystack's own redirect query params are never read for anything
 * beyond identifying which order to check — never trusted as proof of
 * payment (§21: "Never infer payment success from HTTP 201 or the
 * Paystack redirect").
 *
 * Polling is bounded: fixed 2s interval, stops on any terminal attempt
 * status or after `MAX_POLLS` attempts — never infinite
 * (docs/PHASE_9_STOREFRONT_PLAN.md §11 hard requirement).
 */
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15; // ~30s

type Derived =
  | { kind: "loading" }
  | { kind: "success"; attempt: PaymentAttemptRecord }
  | { kind: "failed"; attempt: PaymentAttemptRecord }
  | { kind: "pending"; attempt: PaymentAttemptRecord | null }
  | { kind: "error"; message: string };

/** Pure — given the latest fetched attempts, which UI state to show. Kept
 * standalone (not inlined) so it's directly unit-testable
 * (docs/PHASE_9_STOREFRONT_PLAN.md §23). */
export function derivePaymentResultState(
  attempts: PaymentAttemptRecord[] | null,
  fetchError: string | null,
): Derived {
  if (fetchError) return { kind: "error", message: fetchError };
  if (!attempts || attempts.length === 0)
    return { kind: "pending", attempt: null };

  // Most recent attempt (list is ordered newest-first by the backend) —
  // a retry always supersedes an earlier terminal failure.
  const latest = attempts[0]!;
  if (latest.status === "SUCCESS") return { kind: "success", attempt: latest };
  if (
    latest.status === "FAILED" ||
    latest.status === "ABANDONED" ||
    latest.status === "INITIALIZATION_FAILED"
  ) {
    return { kind: "failed", attempt: latest };
  }
  return { kind: "pending", attempt: latest };
}

export function PaymentResultPanel({
  orderId,
  guestToken,
}: {
  orderId: string;
  guestToken?: string;
}) {
  const [attempts, setAttempts] = useState<PaymentAttemptRecord[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [isRetrying, startRetryTransition] = useTransition();
  const pollCountRef = useRef(0);

  const state = derivePaymentResultState(attempts, fetchError);
  const isTerminal = state.kind === "success" || state.kind === "failed";

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const url = guestToken
          ? `/api/orders/${orderId}/payment-attempts?guestToken=${encodeURIComponent(guestToken)}`
          : `/api/orders/${orderId}/payment-attempts`;
        const res = await fetch(url);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setFetchError(body?.error ?? "Could not check payment status.");
          return;
        }
        setFetchError(null);
        setAttempts(body.attempts ?? []);
      } catch {
        if (!cancelled) setFetchError("Could not check payment status.");
      }
    }

    void poll();
    const interval = setInterval(() => {
      pollCountRef.current += 1;
      setPollCount(pollCountRef.current);
      if (pollCountRef.current >= MAX_POLLS || isTerminal) {
        clearInterval(interval);
        return;
      }
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- polling loop is intentionally self-contained; orderId/guestToken are stable for the page's lifetime
  }, [orderId, guestToken]);

  function handleManualRefresh() {
    startRetryTransition(async () => {
      const url = guestToken
        ? `/api/orders/${orderId}/payment-attempts?guestToken=${encodeURIComponent(guestToken)}`
        : `/api/orders/${orderId}/payment-attempts`;
      const res = await fetch(url);
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setFetchError(null);
        setAttempts(body.attempts ?? []);
      } else {
        setFetchError(body?.error ?? "Could not check payment status.");
      }
    });
  }

  function handleRetryPayment() {
    startRetryTransition(async () => {
      const res = await fetch(`/api/orders/${orderId}/retry-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(guestToken ? { guestToken } : {}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setFetchError(body?.error ?? "Could not retry payment.");
        return;
      }
      if (body.payment?.outcome === "PENDING") {
        window.location.href = body.payment.authorizationUrl;
        return;
      }
      setFetchError(
        body.payment?.errorMessage ?? "Could not start a new payment attempt.",
      );
    });
  }

  if (state.kind === "success") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold">Payment successful</h1>
        <p className="text-muted-foreground">
          Thank you — your order is confirmed.
        </p>
        {guestToken ? (
          <p className="text-sm text-muted-foreground">
            Order #{orderId} — save this reference for your records.
          </p>
        ) : (
          <Button
            nativeButton={false}
            render={<Link href={`/account/orders/${orderId}`} />}
          >
            View your order
          </Button>
        )}
      </div>
    );
  }

  if (state.kind === "failed") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold">Payment unsuccessful</h1>
        <p className="text-muted-foreground">
          {state.attempt.errorMessage ?? "Your payment could not be completed."}
        </p>
        <Button onClick={handleRetryPayment} disabled={isRetrying}>
          {isRetrying ? "Starting…" : "Try payment again"}
        </Button>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold">
          Couldn&apos;t check payment status
        </h1>
        <p className="text-muted-foreground">{state.message}</p>
        <Button onClick={handleManualRefresh} disabled={isRetrying}>
          Check again
        </Button>
      </div>
    );
  }

  // Pending / still processing — including "user returned without
  // completing payment" (an INITIATED/PENDING attempt with no terminal
  // status yet) and the exhausted-polling case.
  const pollingExhausted = pollCount >= MAX_POLLS;
  return (
    <div
      className="flex flex-col items-center gap-4 text-center"
      role="status"
      aria-live="polite"
    >
      <h1 className="text-2xl font-semibold">
        {pollingExhausted
          ? "Still confirming your payment"
          : "Confirming your payment…"}
      </h1>
      <p className="text-muted-foreground">
        {pollingExhausted
          ? "This is taking longer than expected. You can check again, or come back later — we'll email you once it's confirmed."
          : "We're checking with Paystack. This usually takes a few seconds."}
      </p>
      <Button
        onClick={handleManualRefresh}
        disabled={isRetrying}
        variant="outline"
      >
        Check again
      </Button>
    </div>
  );
}
