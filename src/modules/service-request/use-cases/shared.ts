import type { ServiceRequestRow } from "@/src/modules/service-request/repo";
import type { ServiceRequestRecord } from "@/src/modules/service-request/types";

export function toServiceRequestRecord(
  row: ServiceRequestRow,
): ServiceRequestRecord {
  return {
    id: row.id.toString(),
    userId: row.userId?.toString() ?? null,
    requesterName: row.requester?.name ?? row.guestName ?? "Guest",
    requesterEmail: row.requester?.email ?? row.guestEmail,
    requesterPhone: row.requester?.phone ?? row.guestPhone,
    serviceType: row.serviceType,
    status: row.status,
    propertyType: row.propertyType,
    location: row.location,
    currentElectricitySituation: row.currentElectricitySituation,
    estimatedMonthlyUsageKwh: row.estimatedMonthlyUsageKwh?.toString() ?? null,
    appliances: row.appliances,
    desiredBackupHours: row.desiredBackupHours?.toString() ?? null,
    existingEquipment: row.existingEquipment,
    budgetRange: row.budgetRange,
    preferredAppointmentAt: row.preferredAppointmentAt,
    additionalInfo: row.additionalInfo,
    assignedTo: row.assignedTo?.toString() ?? null,
    assigneeName: row.assignee?.name ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
