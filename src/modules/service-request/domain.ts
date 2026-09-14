import type { ServiceRequestStatus } from "@prisma/client";

const ALLOWED_TRANSITIONS: Record<
  ServiceRequestStatus,
  readonly ServiceRequestStatus[]
> = {
  NEW: ["CONTACTED", "CANCELLED"],
  CONTACTED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionServiceRequest(
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function nextServiceRequestStatuses(
  status: ServiceRequestStatus,
): readonly ServiceRequestStatus[] {
  return ALLOWED_TRANSITIONS[status];
}
