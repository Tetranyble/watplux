import { z } from "zod";

import {
  DEFAULT_SERVICE_REQUEST_PAGE_SIZE,
  MAX_SERVICE_REQUEST_PAGE_SIZE,
} from "@/src/modules/service-request/constants";

export const serviceTypeSchema = z.enum([
  "CONSULTATION",
  "SYSTEM_SIZING",
  "INSTALLATION",
  "MAINTENANCE",
  "SITE_ASSESSMENT",
]);
export const serviceRequestStatusSchema = z.enum([
  "NEW",
  "CONTACTED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);
export const propertyTypeSchema = z.enum([
  "RESIDENTIAL",
  "COMMERCIAL",
  "INDUSTRIAL",
]);

const emptyStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyStringToUndefined, z.string().trim().max(max).optional());

const optionalPositiveNumber = (max: number) =>
  z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().positive().max(max).optional(),
  );

const optionalDate = z.preprocess(
  emptyStringToUndefined,
  z.coerce.date().optional(),
);

export const createServiceRequestSchema = z.object({
  serviceType: serviceTypeSchema,
  guestName: optionalText(255),
  guestEmail: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().email().max(255).optional(),
  ),
  guestPhone: optionalText(32),
  propertyType: propertyTypeSchema.optional(),
  location: optionalText(500),
  currentElectricitySituation: optionalText(5000),
  estimatedMonthlyUsageKwh: optionalPositiveNumber(1_000_000),
  appliances: optionalText(5000),
  desiredBackupHours: optionalPositiveNumber(168),
  existingEquipment: optionalText(5000),
  budgetRange: optionalText(50),
  preferredAppointmentAt: optionalDate,
  additionalInfo: optionalText(5000),
});
export type CreateServiceRequestInput = z.infer<
  typeof createServiceRequestSchema
>;

export const listServiceRequestsSchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_SERVICE_REQUEST_PAGE_SIZE)
    .default(DEFAULT_SERVICE_REQUEST_PAGE_SIZE),
  status: serviceRequestStatusSchema.optional(),
  serviceType: serviceTypeSchema.optional(),
  assignedTo: z.coerce.bigint().positive().optional(),
});
export type ListServiceRequestsInput = z.infer<
  typeof listServiceRequestsSchema
>;

export const updateServiceRequestStatusSchema = z.object({
  status: serviceRequestStatusSchema,
});
export type UpdateServiceRequestStatusInput = z.infer<
  typeof updateServiceRequestStatusSchema
>;

export const assignServiceRequestSchema = z.object({
  assignedTo: z.coerce.bigint().positive().nullable(),
});
export type AssignServiceRequestInput = z.infer<
  typeof assignServiceRequestSchema
>;

export const serviceRequestAssignmentActionSchema = z.object({
  assignment: z.enum(["self", "none"]),
});
