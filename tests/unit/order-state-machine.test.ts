import { describe, expect, it } from "vitest";

import {
  canTransition,
  isTerminalStatus,
  nextState,
} from "@/src/modules/order/domain/order-state-machine";
import type {
  OrderStatus,
  OrderTransitionEvent,
} from "@/src/modules/order/domain/order-state-machine";

/** Every documented transition (docs/PHASE_6_ORDER_PLAN.md §3) allowed;
 * every undocumented transition rejected — especially `CANCELLED -> PAID`,
 * which must never succeed under any event. */
describe("order state machine", () => {
  const ALLOWED: Array<[OrderStatus, OrderTransitionEvent, OrderStatus]> = [
    ["PENDING_PAYMENT", "PAY", "PAID"],
    ["PENDING_PAYMENT", "CANCEL", "CANCELLED"],
    ["PAID", "PROCESS", "PROCESSING"],
    ["PAID", "CANCEL", "CANCELLED"],
    ["PAID", "REFUND", "REFUNDED"],
    ["PROCESSING", "DISPATCH", "READY_FOR_DISPATCH"],
    ["PROCESSING", "REFUND", "REFUNDED"],
    ["READY_FOR_DISPATCH", "SHIP", "SHIPPED"],
    ["READY_FOR_DISPATCH", "REFUND", "REFUNDED"],
    ["SHIPPED", "DELIVER", "DELIVERED"],
    ["SHIPPED", "REFUND", "REFUNDED"],
    ["DELIVERED", "REFUND", "REFUNDED"],
  ];

  for (const [current, event, expected] of ALLOWED) {
    it(`allows ${current} --${event}--> ${expected}`, () => {
      expect(nextState(current, event)).toBe(expected);
      expect(canTransition(current, event)).toBe(true);
    });
  }

  const ALL_STATUSES: OrderStatus[] = [
    "PENDING_PAYMENT",
    "PAID",
    "PROCESSING",
    "READY_FOR_DISPATCH",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
    "REFUNDED",
  ];
  const ALL_EVENTS: OrderTransitionEvent[] = [
    "PAY",
    "CANCEL",
    "PROCESS",
    "DISPATCH",
    "SHIP",
    "DELIVER",
    "REFUND",
  ];

  it("CANCELLED -> PAID is impossible via any event (the mandatory late-webhook-after-cancellation guarantee)", () => {
    for (const event of ALL_EVENTS) {
      expect(nextState("CANCELLED", event)).not.toBe("PAID");
    }
    // More strongly: CANCELLED has no outgoing transitions at all.
    for (const event of ALL_EVENTS) {
      expect(nextState("CANCELLED", event)).toBeNull();
      expect(canTransition("CANCELLED", event)).toBe(false);
    }
  });

  it("terminal statuses (DELIVERED, CANCELLED, REFUNDED) have no outgoing transitions except DELIVERED -> REFUNDED", () => {
    expect(isTerminalStatus("DELIVERED")).toBe(true);
    expect(isTerminalStatus("CANCELLED")).toBe(true);
    expect(isTerminalStatus("REFUNDED")).toBe(true);
    expect(isTerminalStatus("PENDING_PAYMENT")).toBe(false);
    expect(isTerminalStatus("PAID")).toBe(false);

    for (const event of ALL_EVENTS) {
      if (event === "REFUND") continue; // DELIVERED -> REFUNDED is the one exception
      expect(canTransition("DELIVERED", event)).toBe(false);
    }
    for (const event of ALL_EVENTS) {
      expect(canTransition("CANCELLED", event)).toBe(false);
      expect(canTransition("REFUNDED", event)).toBe(false);
    }
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
