/**
 * Pure refund lifecycle specification — zero I/O, mirroring
 * `order/domain/order-state-machine.ts`'s exact shape. Encodes the exact
 * `RefundStatus` enum and transition table from
 * docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §18 — no invented states.
 */

export type RefundStatus =
  | "REFUND_REQUESTED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "REFUND_FAILED"
  | "REFUND_CANCELLED";

export type RefundTransitionEvent =
  | "PAYSTACK_ACCEPTS" // REFUND_REQUESTED -> REFUND_PENDING
  | "API_FAILS" // REFUND_REQUESTED | REFUND_PENDING -> REFUND_FAILED
  | "ADMIN_CANCELS" // REFUND_REQUESTED | REFUND_PENDING -> REFUND_CANCELLED
  | "WEBHOOK_CONFIRMS"; // REFUND_PENDING -> REFUNDED

const TRANSITIONS: Record<
  RefundStatus,
  Partial<Record<RefundTransitionEvent, RefundStatus>>
> = {
  REFUND_REQUESTED: {
    PAYSTACK_ACCEPTS: "REFUND_PENDING",
    API_FAILS: "REFUND_FAILED",
    ADMIN_CANCELS: "REFUND_CANCELLED",
  },
  REFUND_PENDING: {
    WEBHOOK_CONFIRMS: "REFUNDED",
    API_FAILS: "REFUND_FAILED",
    ADMIN_CANCELS: "REFUND_CANCELLED",
  },
  REFUNDED: {},
  REFUND_FAILED: {},
  REFUND_CANCELLED: {},
};

const TERMINAL_STATUSES: ReadonlySet<RefundStatus> = new Set([
  "REFUNDED",
  "REFUND_FAILED",
  "REFUND_CANCELLED",
]);

export function isTerminalStatus(status: RefundStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Whether this status still holds an allocation in
 * `payment_attempts.pending_refund_amount_minor` (plan §19) — both
 * non-terminal statuses do; every terminal one has already released or
 * confirmed it. */
export function holdsAllocation(status: RefundStatus): boolean {
  return status === "REFUND_REQUESTED" || status === "REFUND_PENDING";
}

export function nextState(
  current: RefundStatus,
  event: RefundTransitionEvent,
): RefundStatus | null {
  return TRANSITIONS[current][event] ?? null;
}

export function canTransition(
  current: RefundStatus,
  event: RefundTransitionEvent,
): boolean {
  return nextState(current, event) !== null;
}
