import { describe, expect, it } from "vitest";

import { derivePaymentResultState } from "@/components/storefront/payment-result-panel";
import type { PaymentAttemptRecord } from "@/src/modules/payment/types";

function attempt(
  overrides: Partial<PaymentAttemptRecord> = {},
): PaymentAttemptRecord {
  return {
    id: "1",
    orderId: "1",
    paystackReference: "ref-1",
    amountMinor: 100_000,
    currency: "NGN",
    status: "PENDING",
    channel: null,
    authorizationUrl: null,
    errorCode: null,
    errorMessage: null,
    refundedAmountMinor: 0,
    pendingRefundAmountMinor: 0,
    availableRefundableAmountMinor: null,
    paidAt: null,
    failedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("derivePaymentResultState (docs/PHASE_9_STOREFRONT_PLAN.md §13/§23)", () => {
  it("a fetch error takes priority over any attempt data", () => {
    expect(
      derivePaymentResultState(
        [attempt({ status: "SUCCESS" })],
        "network down",
      ),
    ).toEqual({
      kind: "error",
      message: "network down",
    });
  });

  it("no attempts yet is pending, not an error", () => {
    expect(derivePaymentResultState([], null)).toEqual({
      kind: "pending",
      attempt: null,
    });
    expect(derivePaymentResultState(null, null)).toEqual({
      kind: "pending",
      attempt: null,
    });
  });

  it("a SUCCESS attempt is the success state", () => {
    const success = attempt({ status: "SUCCESS" });
    expect(derivePaymentResultState([success], null)).toEqual({
      kind: "success",
      attempt: success,
    });
  });

  it("FAILED, ABANDONED, and INITIALIZATION_FAILED are all the failed state", () => {
    for (const status of [
      "FAILED",
      "ABANDONED",
      "INITIALIZATION_FAILED",
    ] as const) {
      const failed = attempt({ status });
      expect(derivePaymentResultState([failed], null)).toEqual({
        kind: "failed",
        attempt: failed,
      });
    }
  });

  it("INITIATED/PENDING are the pending state, not failed or success", () => {
    for (const status of ["INITIATED", "PENDING"] as const) {
      const pending = attempt({ status });
      expect(derivePaymentResultState([pending], null)).toEqual({
        kind: "pending",
        attempt: pending,
      });
    }
  });

  it("uses only the most recent (first) attempt — a later retry supersedes an earlier terminal failure", () => {
    const retrySucceeded = attempt({ id: "2", status: "SUCCESS" });
    const originalFailed = attempt({ id: "1", status: "FAILED" });
    // Backend orders newest-first — the retry (index 0) wins.
    expect(
      derivePaymentResultState([retrySucceeded, originalFailed], null),
    ).toEqual({
      kind: "success",
      attempt: retrySucceeded,
    });
  });
});
