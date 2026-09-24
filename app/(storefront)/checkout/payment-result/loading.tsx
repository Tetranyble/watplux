"use client";

import { Loader2 } from "lucide-react";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

/** Explicitly communicates active payment confirmation — not a generic
 * skeleton (docs/PHASE_9_STOREFRONT_PLAN.md §16/§22). */
export default function PaymentResultLoading() {
  const copy = useSiteCopy();
  return (
    <div
      className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center"
      role="status"
      aria-live="polite"
    >
      <Loader2
        className="size-8 animate-spin text-primary-emphasis"
        aria-hidden="true"
      />
      <h1 className="text-2xl font-semibold">
        {copy("commerce.payment.confirmingTitle")}
      </h1>
      <p className="text-muted-foreground">
        {copy("commerce.payment.confirmingDescription")}
      </p>
    </div>
  );
}
