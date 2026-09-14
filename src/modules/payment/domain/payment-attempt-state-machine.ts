/**
 * Pure payment-attempt lifecycle specification — zero I/O, mirroring
 * `order/domain/order-state-machine.ts`'s and
 * `cart/domain/cart-state-machine.ts`'s exact shape. Encodes the exact
 * `PaymentAttemptStatus` enum and transition table from
 * docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §5 — no invented states, no
 * invented transitions.
 */

export type PaymentAttemptStatus =
  | "INITIATED"
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "ABANDONED"
  | "INITIALIZATION_FAILED";

export type PaymentAttemptTransitionEvent =
  | "INITIALIZE_SUCCEED" // INITIATED -> PENDING
  | "INITIALIZE_FAIL" // INITIATED -> INITIALIZATION_FAILED
  | "VERIFY_SUCCEED" // PENDING -> SUCCESS
  | "VERIFY_FAIL" // PENDING -> FAILED
  | "ABANDON"; // PENDING -> ABANDONED (TTL sweep, plan §8.4 — not built this phase)

const TRANSITIONS: Record<
  PaymentAttemptStatus,
  Partial<Record<PaymentAttemptTransitionEvent, PaymentAttemptStatus>>
> = {
  INITIATED: {
    INITIALIZE_SUCCEED: "PENDING",
    INITIALIZE_FAIL: "INITIALIZATION_FAILED",
  },
  PENDING: {
    VERIFY_SUCCEED: "SUCCESS",
    VERIFY_FAIL: "FAILED",
    ABANDON: "ABANDONED",
  },
  SUCCESS: {},
  FAILED: {},
  ABANDONED: {},
  INITIALIZATION_FAILED: {},
};

const TERMINAL_STATUSES: ReadonlySet<PaymentAttemptStatus> = new Set([
  "SUCCESS",
  "FAILED",
  "ABANDONED",
  "INITIALIZATION_FAILED",
]);

export function isTerminalStatus(status: PaymentAttemptStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Returns the resulting status for `current -> event`, or `null` if that
 * transition is not in the approved table — including, explicitly, every
 * transition out of a terminal state via any event, since no entry
 * exists for any of them. Pure — never throws. */
export function nextState(
  current: PaymentAttemptStatus,
  event: PaymentAttemptTransitionEvent,
): PaymentAttemptStatus | null {
  return TRANSITIONS[current][event] ?? null;
}

export function canTransition(
  current: PaymentAttemptStatus,
  event: PaymentAttemptTransitionEvent,
): boolean {
  return nextState(current, event) !== null;
}
