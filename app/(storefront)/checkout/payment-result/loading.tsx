import { Loader2 } from "lucide-react";

/** Explicitly communicates active payment confirmation — not a generic
 * skeleton (docs/PHASE_9_STOREFRONT_PLAN.md §16/§22). */
export default function PaymentResultLoading() {
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
      <h1 className="text-2xl font-semibold">Confirming your payment…</h1>
      <p className="text-muted-foreground">
        We&apos;re checking with Paystack. This usually takes a few seconds.
      </p>
    </div>
  );
}
