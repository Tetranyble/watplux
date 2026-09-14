"use server";

import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";
import { createServiceRequestSchema } from "@/src/modules/service-request/schema";
import { createServiceRequest } from "@/src/modules/service-request/use-cases/create-service-request";

export interface ServiceRequestFormState {
  error?: string;
}

function optional(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function submitServiceRequest(
  _previousState: ServiceRequestFormState,
  formData: FormData,
): Promise<ServiceRequestFormState> {
  const parsed = createServiceRequestSchema.safeParse({
    serviceType: formData.get("serviceType"),
    guestName: optional(formData, "guestName"),
    guestEmail: optional(formData, "guestEmail"),
    guestPhone: optional(formData, "guestPhone"),
    propertyType: optional(formData, "propertyType"),
    location: optional(formData, "location"),
    currentElectricitySituation: optional(
      formData,
      "currentElectricitySituation",
    ),
    estimatedMonthlyUsageKwh: optional(formData, "estimatedMonthlyUsageKwh"),
    appliances: optional(formData, "appliances"),
    desiredBackupHours: optional(formData, "desiredBackupHours"),
    existingEquipment: optional(formData, "existingEquipment"),
    budgetRange: optional(formData, "budgetRange"),
    preferredAppointmentAt: optional(formData, "preferredAppointmentAt"),
    additionalInfo: optional(formData, "additionalInfo"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Check the request details.",
    };
  }

  try {
    const actor = await getSessionUser();
    const created = await createServiceRequest(actor, parsed.data);
    redirect(`/service-request-submitted?id=${created.id}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    return {
      error:
        error instanceof Error
          ? error.message
          : "We could not submit your request. Please try again.",
    };
  }
}
