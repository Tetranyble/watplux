import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { PaymentResultPanel } from "@/components/storefront/payment-result-panel";

export const metadata: Metadata = {
  title: "Payment status",
};

// Always reads live, authoritative server state on every visit — never
// cached (docs/PHASE_9_STOREFRONT_PLAN.md §8/§13).
export const instant = false;

export default async function PaymentResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const orderIdParam = params.orderId;
  const orderId = Array.isArray(orderIdParam) ? orderIdParam[0] : orderIdParam;
  // Paystack's own `reference`/`trxref` redirect params are deliberately
  // never read here — they are the exact "browser-controlled value as
  // proof of payment" the approval explicitly forbids treating as
  // authoritative (§11/§21). `orderId` is only ever used as an
  // identifier for which order to authoritatively re-check server-side.
  const guestTokenParam = params.guestToken;
  const guestToken = Array.isArray(guestTokenParam)
    ? guestTokenParam[0]
    : guestTokenParam;

  if (!orderId) {
    redirect("/products");
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16">
      <PaymentResultPanel orderId={orderId} guestToken={guestToken} />
    </div>
  );
}
