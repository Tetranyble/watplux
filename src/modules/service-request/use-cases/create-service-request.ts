import { ValidationError } from "@/lib/errors";
import * as serviceRequestRepo from "@/src/modules/service-request/repo";
import {
  createServiceRequestSchema,
  type CreateServiceRequestInput,
} from "@/src/modules/service-request/schema";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { sendServiceRequestAcknowledgement } from "@/src/modules/service-request/use-cases/send-service-request-acknowledgement";
import { toServiceRequestRecord } from "@/src/modules/service-request/use-cases/shared";

export async function createServiceRequest(
  actor: AuthenticatedUser | null,
  rawInput: CreateServiceRequestInput,
) {
  const input = createServiceRequestSchema.parse(rawInput);
  if (!actor && (!input.guestName || !input.guestEmail || !input.guestPhone)) {
    throw new ValidationError(
      "Name, email and phone are required when requesting a service as a guest.",
    );
  }
  const row = await serviceRequestRepo.createServiceRequest({
    userId: actor?.id ?? null,
    input,
  });
  const request = toServiceRequestRecord(row);
  // Persistence is authoritative. Notification providers are best-effort and
  // log their own failures, so an SMTP/SMS outage never loses or duplicates a
  // customer's already-created request.
  await sendServiceRequestAcknowledgement(request);
  return request;
}
