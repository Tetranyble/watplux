/**
 * Pure cart lifecycle specification — zero I/O, per the ESLint
 * `boundaries/dependencies` rule (`domain` cannot import `repo`, and
 * `repo` cannot import `domain` back). Encodes the exact `CartStatus`
 * enum and transition table from `docs/PHASE_7_CART_CHECKOUT_PLAN.md`
 * §13 — no invented states, no invented transitions. Mirrors
 * `src/modules/order/domain/order-state-machine.ts`'s shape exactly:
 * pure predicates/lookups that return a value, never throw.
 */

export type CartStatus = "ACTIVE" | "CONVERTED" | "ABANDONED";

export type CartTransitionEvent = "CONVERT" | "ABANDON";

/**
 * The complete transition table (plan §13). Only `ACTIVE -> CONVERTED`
 * (via `CONVERT`) has a use-case calling it in Phase 7 (checkout success,
 * and the guest cart's own transition on a successful merge). `ABANDON`
 * is encoded so the state machine knows the transition exists, even
 * though no Phase 7 use-case triggers it — that requires job-runner
 * infrastructure this codebase does not have yet (plan §33, open
 * question 4).
 *
 * `CONVERTED`/`ABANDONED` have no outgoing transitions at all — both are
 * terminal, matching plan §13's explicit rule that a converted cart must
 * never be reused for another checkout.
 */
const TRANSITIONS: Record<
  CartStatus,
  Partial<Record<CartTransitionEvent, CartStatus>>
> = {
  ACTIVE: {
    CONVERT: "CONVERTED",
    ABANDON: "ABANDONED",
  },
  CONVERTED: {},
  ABANDONED: {},
};

const TERMINAL_STATUSES: ReadonlySet<CartStatus> = new Set([
  "CONVERTED",
  "ABANDONED",
]);

export function isTerminalStatus(status: CartStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Returns the resulting status for `current -> event`, or `null` if that
 * transition is not in the approved table (plan §13). Pure — never
 * throws; the calling use-case/repo decides what a `null` result means
 * (e.g. `ConflictError`). */
export function nextState(
  current: CartStatus,
  event: CartTransitionEvent,
): CartStatus | null {
  return TRANSITIONS[current][event] ?? null;
}

/** Non-throwing boolean form, for call sites that just want a yes/no. */
export function canTransition(
  current: CartStatus,
  event: CartTransitionEvent,
): boolean {
  return nextState(current, event) !== null;
}
