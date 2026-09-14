"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/ui/toast";

import { Button } from "@/components/ui/button";

/** Cancel/retry both call the existing, unmodified order/payment routes —
 * ownership/permission enforcement happens server-side regardless of
 * whether these buttons are shown (docs/PHASE_9_STOREFRONT_PLAN.md §12/§21:
 * "Do not rely on UI hiding as authorization"). */
export function OrderActions({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  function handleCancel() {
    startTransition(async () => {
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Could not cancel this order.");
        return;
      }
      toast.success("Order cancelled.");
      setConfirmingCancel(false);
      router.refresh();
    });
  }

  function handleRetryPayment() {
    startTransition(async () => {
      const res = await fetch(`/api/orders/${orderId}/retry-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Could not retry payment.");
        return;
      }
      if (body.payment?.outcome === "PENDING") {
        window.location.href = body.payment.authorizationUrl;
        return;
      }
      router.push(`/checkout/payment-result?orderId=${orderId}`);
    });
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={handleRetryPayment} disabled={isPending}>
        Retry payment
      </Button>
      {confirmingCancel ? (
        <>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={isPending}
          >
            Confirm cancellation
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirmingCancel(false)}
            disabled={isPending}
          >
            Never mind
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          onClick={() => setConfirmingCancel(true)}
          disabled={isPending}
        >
          Cancel order
        </Button>
      )}
    </div>
  );
}
