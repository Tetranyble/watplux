import { describe, expect, it } from "vitest";

import {
  canTransitionServiceRequest,
  nextServiceRequestStatuses,
} from "@/src/modules/service-request/domain";

describe("service request state machine", () => {
  it("allows the normal operational progression", () => {
    expect(canTransitionServiceRequest("NEW", "CONTACTED")).toBe(true);
    expect(canTransitionServiceRequest("CONTACTED", "SCHEDULED")).toBe(true);
    expect(canTransitionServiceRequest("SCHEDULED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionServiceRequest("IN_PROGRESS", "COMPLETED")).toBe(true);
  });

  it("allows cancellation only before a terminal state", () => {
    for (const status of [
      "NEW",
      "CONTACTED",
      "SCHEDULED",
      "IN_PROGRESS",
    ] as const) {
      expect(canTransitionServiceRequest(status, "CANCELLED")).toBe(true);
    }
    expect(nextServiceRequestStatuses("COMPLETED")).toEqual([]);
    expect(nextServiceRequestStatuses("CANCELLED")).toEqual([]);
  });

  it("rejects skipped or backwards transitions", () => {
    expect(canTransitionServiceRequest("NEW", "COMPLETED")).toBe(false);
    expect(canTransitionServiceRequest("IN_PROGRESS", "CONTACTED")).toBe(false);
    expect(canTransitionServiceRequest("COMPLETED", "IN_PROGRESS")).toBe(false);
  });
});
