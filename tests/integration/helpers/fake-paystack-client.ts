import { generatePaystackSafeReference } from "@/src/integrations/paystack/reference";
import type { PaystackClient } from "@/src/modules/payment/types";

/**
 * A deterministic, in-memory, test-only implementation of `PaystackClient`
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §28.4) — real MySQL, real
 * application code, fake Paystack only. Never makes a real network call.
 * Mirrors `tests/integration/helpers/fixtures.ts`'s
 * the established fake-integration-client pattern: an object literal
 * satisfying the module-owned interface, injected in place of the
 * default real implementation.
 */
export function createFakePaystackClient(
  overrides: Partial<PaystackClient> = {},
): PaystackClient {
  return {
    async initializeTransaction(params) {
      return {
        authorizationUrl: `https://checkout.paystack.test/${params.reference}`,
        accessCode: generatePaystackSafeReference("ACCESS"),
        reference: params.reference,
      };
    },
    async verifyTransaction(reference) {
      return {
        id: Math.floor(Math.random() * 1_000_000_000),
        status: "success",
        reference,
        amountMinor: 0,
        currency: "NGN",
        gatewayResponse: "Approved",
        channel: "card",
        paidAt: new Date().toISOString(),
      };
    },
    async createRefund(params) {
      return {
        status: "pending",
        transactionReference: params.transactionReference,
      };
    },
    ...overrides,
  };
}

/** A fake client whose `verifyTransaction` always reports success with
 * amount/currency matching whatever the caller expects — used by tests
 * that need `verifyTransaction` to reflect a SPECIFIC attempt's real
 * amount/currency (the amount/currency mismatch validation, plan §9.3,
 * requires a deliberately WRONG value instead — use `createFakePaystackClient`
 * with an explicit `verifyTransaction` override for those cases). */
export function createSuccessVerifyingClient(
  amountMinor: number,
  currency = "NGN",
): PaystackClient {
  return createFakePaystackClient({
    async verifyTransaction(reference) {
      return {
        id: Math.floor(Math.random() * 1_000_000_000),
        status: "success",
        reference,
        amountMinor,
        currency,
        gatewayResponse: "Approved",
        channel: "card",
        paidAt: new Date().toISOString(),
      };
    },
  });
}
