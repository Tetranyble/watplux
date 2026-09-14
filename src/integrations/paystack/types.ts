/**
 * Narrow, typed shapes for the fields this codebase actually reads from
 * Paystack's API responses — not a full mirror of Paystack's schema.
 * docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §7: this file contains no
 * business logic, only shape declarations.
 */

export interface InitializeTransactionParams {
  amountMinor: number;
  email: string;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

/** Paystack's own transaction status values (verified against current
 * documentation research, docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §7) —
 * only `"success"` is ever treated as a successful payment; every other
 * value (including ones not listed here, defensively) is a
 * non-success outcome. */
export type PaystackTransactionStatus =
  "success" | "failed" | "abandoned" | "reversed" | (string & {});

export interface VerifyTransactionResult {
  id: number;
  status: PaystackTransactionStatus;
  reference: string;
  amountMinor: number;
  currency: string;
  gatewayResponse: string | null;
  channel: string | null;
  paidAt: string | null;
}

export interface CreateRefundParams {
  transactionReference: string;
  amountMinor?: number;
  merchantNote?: string;
}

export interface CreateRefundResult {
  status: string;
  transactionReference: string;
}
