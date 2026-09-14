import { describe, expect, it } from "vitest";

import {
  canTransition,
  isTerminalStatus,
  nextState,
} from "@/src/modules/payment/domain/payment-attempt-state-machine";
import type {
  PaymentAttemptStatus,
  PaymentAttemptTransitionEvent,
} from "@/src/modules/payment/domain/payment-attempt-state-machine";

/** Every documented transition (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §5)
 * allowed; every undocumented transition rejected — mirrors
 * `tests/unit/order-state-machine.test.ts`'s exact shape. */
describe("payment attempt state machine", () => {
  const ALLOWED: Array<
    [PaymentAttemptStatus, PaymentAttemptTransitionEvent, PaymentAttemptStatus]
  > = [
    ["INITIATED", "INITIALIZE_SUCCEED", "PENDING"],
    ["INITIATED", "INITIALIZE_FAIL", "INITIALIZATION_FAILED"],
    ["PENDING", "VERIFY_SUCCEED", "SUCCESS"],
    ["PENDING", "VERIFY_FAIL", "FAILED"],
    ["PENDING", "ABANDON", "ABANDONED"],
  ];

  for (const [current, event, expected] of ALLOWED) {
    it(`allows ${current} --${event}--> ${expected}`, () => {
      expect(nextState(current, event)).toBe(expected);
      expect(canTransition(current, event)).toBe(true);
    });
  }

  const ALL_STATUSES: PaymentAttemptStatus[] = [
    "INITIATED",
    "PENDING",
    "SUCCESS",
    "FAILED",
    "ABANDONED",
    "INITIALIZATION_FAILED",
  ];
  const ALL_EVENTS: PaymentAttemptTransitionEvent[] = [
    "INITIALIZE_SUCCEED",
    "INITIALIZE_FAIL",
    "VERIFY_SUCCEED",
    "VERIFY_FAIL",
    "ABANDON",
  ];

  it("every terminal state has zero outgoing transitions — FAILED/ABANDONED/INITIALIZATION_FAILED/SUCCESS -> anything is always rejected", () => {
    for (const status of [
      "SUCCESS",
      "FAILED",
      "ABANDONED",
      "INITIALIZATION_FAILED",
    ] as const) {
      expect(isTerminalStatus(status)).toBe(true);
      for (const event of ALL_EVENTS) {
        expect(nextState(status, event)).toBeNull();
        expect(canTransition(status, event)).toBe(false);
      }
    }
  });

  it("INITIATED and PENDING are not terminal", () => {
    expect(isTerminalStatus("INITIATED")).toBe(false);
    expect(isTerminalStatus("PENDING")).toBe(false);
  });

  it("FAILED -> SUCCESS, ABANDONED -> SUCCESS, and INITIALIZATION_FAILED -> SUCCESS are all structurally impossible", () => {
    expect(nextState("FAILED", "VERIFY_SUCCEED")).toBeNull();
    expect(nextState("ABANDONED", "VERIFY_SUCCEED")).toBeNull();
    expect(nextState("INITIALIZATION_FAILED", "VERIFY_SUCCEED")).toBeNull();
  });

  it("every undocumented (status, event) pair returns null, never throws", () => {
    for (const status of ALL_STATUSES) {
      for (const event of ALL_EVENTS) {
        const isAllowed = ALLOWED.some(([s, e]) => s === status && e === event);
        if (!isAllowed) {
          expect(() => nextState(status, event)).not.toThrow();
          expect(nextState(status, event)).toBeNull();
        }
      }
    }
  });
});
