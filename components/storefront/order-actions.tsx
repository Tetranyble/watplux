"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/ui/toast";

import { Button } from "@/components/ui/button";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

/** Cancel/retry both call the existing, unmodified order/payment routes —
 * ownership/permission enforcement happens server-side regardless of
 * whether these buttons are shown (docs/PHASE_9_STOREFRONT_PLAN.md §12/§21:
 * "Do not rely on UI hiding as authorization"). */
export function OrderActions({ orderId }: { orderId: string }) {
  const copy = useSiteCopy();
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
        toast.error(body?.error ?? copy("commerce.order.cancelFailed"));
        return;
      }
      toast.success(copy("commerce.order.cancelled"));
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
        toast.error(body?.error ?? copy("commerce.order.retryFailed"));
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
        {copy("commerce.order.retry")}
      </Button>
      {confirmingCancel ? (
        <>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={isPending}
          >
            {copy("commerce.order.confirmCancel")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirmingCancel(false)}
            disabled={isPending}
          >
            {copy("commerce.order.neverMind")}
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          onClick={() => setConfirmingCancel(true)}
          disabled={isPending}
        >
          {copy("commerce.order.cancel")}
        </Button>
      )}
    </div>
  );
}
