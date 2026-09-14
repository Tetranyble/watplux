import type {
  PropertyType,
  ServiceRequestStatus,
  ServiceType,
} from "@prisma/client";

export interface ServiceRequestRecord {
  id: string;
  userId: string | null;
  requesterName: string;
  requesterEmail: string | null;
  requesterPhone: string | null;
  serviceType: ServiceType;
  status: ServiceRequestStatus;
  propertyType: PropertyType | null;
  location: string | null;
  currentElectricitySituation: string | null;
  estimatedMonthlyUsageKwh: string | null;
  appliances: string | null;
  desiredBackupHours: string | null;
  existingEquipment: string | null;
  budgetRange: string | null;
  preferredAppointmentAt: Date | null;
  additionalInfo: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
