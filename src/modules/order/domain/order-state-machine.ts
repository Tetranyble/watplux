/**
 * Pure order lifecycle specification — zero I/O, per the ESLint
 * `boundaries/dependencies` rule (`domain` cannot import `repo`, so this
 * file can never touch Prisma and `repo.ts` can never import this file
 * back — `domain` is itself disallowed from being imported by `repo`,
 * confirmed against `eslint.config.mjs` during planning). Encodes the
 * exact `OrderStatus` enum and transition table from
 * `docs/PHASE_6_ORDER_PLAN.md` §3 — no invented states, no invented
 * transitions. Matches `src/modules/catalog/domain/money.ts`'s established
 * convention: pure predicates/lookups that return a value, never throw —
 * the calling use-case decides what error, if any, a `null`/`false`
 * result means.
 *
 * `src/modules/order/` (singular) deliberately deviates from
 * `docs/ARCHITECTURE.md` §8's illustrative `src/modules/orders/` (plural)
 * to match the established convention every real module in this
 * repository uses (`catalog`, `inventory`, `auth`) — see the plan §3.
 */

export type OrderStatus =
  | "PENDING_PAYMENT"
  | "PAID"
  | "PROCESSING"
  | "READY_FOR_DISPATCH"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "REFUNDED";

export type OrderTransitionEvent =
  "PAY" | "CANCEL" | "PROCESS" | "DISPATCH" | "SHIP" | "DELIVER" | "REFUND";

/**
 * The complete transition table (plan §3). Only `PENDING_PAYMENT`'s two
 * outgoing transitions (`PAY`, `CANCEL`) have a use-case calling them in
 * Phase 6 (`markOrderPaid`, `cancelOrder`). Every other transition below
 * is encoded so the state machine never has to be revisited to "discover"
 * a transition later phases need — but no Phase 6 use-case reaches them.
 *
 * `PAID -> CANCELLED` (admin refund flow) is intentionally present: the
 * plan requires the state machine to *know* this transition exists, even
 * though no Phase 6 use-case performs it (it depends on Refund/Paystack
 * machinery this phase excludes).
 *
 * `CANCELLED -> PAID` is intentionally **absent** — a late webhook success
 * arriving after cancellation must never resurrect the order (plan §11).
 * `CANCELLED`/`REFUNDED` have no outgoing transitions at all — genuinely
 * terminal. `DELIVERED` is terminal for the *forward fulfillment chain*
 * (nothing comes after "delivered") but still allows one outgoing edge,
 * `REFUND -> REFUNDED`, per the plan's own transition table ("PAID/
 * PROCESSING/READY_FOR_DISPATCH/SHIPPED/DELIVERED -> REFUNDED").
 */
const TRANSITIONS: Record<
  OrderStatus,
  Partial<Record<OrderTransitionEvent, OrderStatus>>
> = {
  PENDING_PAYMENT: {
    PAY: "PAID",
    CANCEL: "CANCELLED",
  },
  PAID: {
    PROCESS: "PROCESSING",
    CANCEL: "CANCELLED",
    REFUND: "REFUNDED",
  },
  PROCESSING: {
    DISPATCH: "READY_FOR_DISPATCH",
    REFUND: "REFUNDED",
  },
  READY_FOR_DISPATCH: {
    SHIP: "SHIPPED",
    REFUND: "REFUNDED",
  },
  SHIPPED: {
    DELIVER: "DELIVERED",
    REFUND: "REFUNDED",
  },
  DELIVERED: {
    REFUND: "REFUNDED",
  },
  CANCELLED: {},
  REFUNDED: {},
};

const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Returns the resulting status for `current -> event`, or `null` if that
 * transition is not in the approved table (plan §3) — including,
 * explicitly, `CANCELLED -> PAID` via any event, since no entry for
 * `CANCELLED` exists at all. Pure — never throws; the calling use-case
 * decides what a `null` result means (e.g. `ValidationError`). */
export function nextState(
  current: OrderStatus,
  event: OrderTransitionEvent,
): OrderStatus | null {
  return TRANSITIONS[current][event] ?? null;
}

/** Non-throwing boolean form, for call sites that just want a yes/no
 * (e.g. a UI-facing "can this order still be cancelled?" check). */
export function canTransition(
  current: OrderStatus,
  event: OrderTransitionEvent,
): boolean {
  return nextState(current, event) !== null;
}
