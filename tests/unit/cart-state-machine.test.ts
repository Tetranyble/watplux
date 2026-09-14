import { describe, expect, it } from "vitest";

import {
  canTransition,
  isTerminalStatus,
  nextState,
} from "@/src/modules/cart/domain/cart-state-machine";
import type {
  CartStatus,
  CartTransitionEvent,
} from "@/src/modules/cart/domain/cart-state-machine";

/** Every documented transition (docs/PHASE_7_CART_CHECKOUT_PLAN.md §13)
 * allowed; every undocumented transition rejected — mirrors
 * `tests/unit/order-state-machine.test.ts`'s exact shape. */
describe("cart state machine", () => {
  const ALLOWED: Array<[CartStatus, CartTransitionEvent, CartStatus]> = [
    ["ACTIVE", "CONVERT", "CONVERTED"],
    ["ACTIVE", "ABANDON", "ABANDONED"],
  ];

  for (const [current, event, expected] of ALLOWED) {
    it(`allows ${current} --${event}--> ${expected}`, () => {
      expect(nextState(current, event)).toBe(expected);
      expect(canTransition(current, event)).toBe(true);
    });
  }

  const ALL_STATUSES: CartStatus[] = ["ACTIVE", "CONVERTED", "ABANDONED"];
  const ALL_EVENTS: CartTransitionEvent[] = ["CONVERT", "ABANDON"];

  it("CONVERTED and ABANDONED are terminal — no outgoing transitions at all", () => {
    expect(isTerminalStatus("CONVERTED")).toBe(true);
    expect(isTerminalStatus("ABANDONED")).toBe(true);
    expect(isTerminalStatus("ACTIVE")).toBe(false);

    for (const event of ALL_EVENTS) {
      expect(nextState("CONVERTED", event)).toBeNull();
      expect(canTransition("CONVERTED", event)).toBe(false);
      expect(nextState("ABANDONED", event)).toBeNull();
      expect(canTransition("ABANDONED", event)).toBe(false);
    }
  });

  it("a converted cart can never be reused for another checkout — CONVERTED -> CONVERTED via CONVERT is impossible", () => {
    expect(nextState("CONVERTED", "CONVERT")).not.toBe("CONVERTED");
    expect(nextState("CONVERTED", "CONVERT")).toBeNull();
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
