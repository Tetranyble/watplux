import { describe, expect, it } from "vitest";

import {
  canTransition,
  holdsAllocation,
  isTerminalStatus,
  nextState,
} from "@/src/modules/payment/domain/refund-state-machine";
import type {
  RefundStatus,
  RefundTransitionEvent,
} from "@/src/modules/payment/domain/refund-state-machine";

describe("refund state machine", () => {
  const ALLOWED: Array<[RefundStatus, RefundTransitionEvent, RefundStatus]> = [
    ["REFUND_REQUESTED", "PAYSTACK_ACCEPTS", "REFUND_PENDING"],
    ["REFUND_REQUESTED", "API_FAILS", "REFUND_FAILED"],
    ["REFUND_REQUESTED", "ADMIN_CANCELS", "REFUND_CANCELLED"],
    ["REFUND_PENDING", "WEBHOOK_CONFIRMS", "REFUNDED"],
    ["REFUND_PENDING", "API_FAILS", "REFUND_FAILED"],
    ["REFUND_PENDING", "ADMIN_CANCELS", "REFUND_CANCELLED"],
  ];

  for (const [current, event, expected] of ALLOWED) {
    it(`allows ${current} --${event}--> ${expected}`, () => {
      expect(nextState(current, event)).toBe(expected);
      expect(canTransition(current, event)).toBe(true);
    });
  }

  const ALL_STATUSES: RefundStatus[] = [
    "REFUND_REQUESTED",
    "REFUND_PENDING",
    "REFUNDED",
    "REFUND_FAILED",
    "REFUND_CANCELLED",
  ];
  const ALL_EVENTS: RefundTransitionEvent[] = [
    "PAYSTACK_ACCEPTS",
    "API_FAILS",
    "ADMIN_CANCELS",
    "WEBHOOK_CONFIRMS",
  ];

  it("REFUNDED/REFUND_FAILED/REFUND_CANCELLED are terminal — no outgoing transitions", () => {
    for (const status of [
      "REFUNDED",
      "REFUND_FAILED",
      "REFUND_CANCELLED",
    ] as const) {
      expect(isTerminalStatus(status)).toBe(true);
      for (const event of ALL_EVENTS) {
        expect(nextState(status, event)).toBeNull();
      }
    }
  });

  it("holdsAllocation is true only for the two non-terminal statuses", () => {
    expect(holdsAllocation("REFUND_REQUESTED")).toBe(true);
    expect(holdsAllocation("REFUND_PENDING")).toBe(true);
    expect(holdsAllocation("REFUNDED")).toBe(false);
    expect(holdsAllocation("REFUND_FAILED")).toBe(false);
    expect(holdsAllocation("REFUND_CANCELLED")).toBe(false);
  });

  it("a refund marked REFUND_FAILED can never later become REFUNDED merely because Paystack accepted the original API request", () => {
    expect(nextState("REFUND_FAILED", "WEBHOOK_CONFIRMS")).toBeNull();
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
