import type { Prisma, ServiceRequestStatus, ServiceType } from "@prisma/client";

import { db } from "@/lib/db";
import type { CreateServiceRequestInput } from "@/src/modules/service-request/schema";

const includePeople = {
  requester: { select: { name: true, email: true, phone: true } },
  assignee: { select: { name: true } },
} satisfies Prisma.ServiceRequestInclude;

export type ServiceRequestRow = Prisma.ServiceRequestGetPayload<{
  include: typeof includePeople;
}>;

function encodeCursor(row: { createdAt: Date; id: bigint }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): { createdAt: Date; id: bigint } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const [createdAtRaw, idRaw] = decoded.split("|");
  const createdAt = new Date(createdAtRaw ?? "");
  if (!createdAtRaw || !idRaw || Number.isNaN(createdAt.getTime())) {
    throw new Error("Invalid service-request cursor.");
  }
  return { createdAt, id: BigInt(idRaw) };
}

export async function createServiceRequest(params: {
  userId: bigint | null;
  input: CreateServiceRequestInput;
}): Promise<ServiceRequestRow> {
  return db.serviceRequest.create({
    data: {
      userId: params.userId,
      guestName: params.userId ? null : params.input.guestName,
      guestEmail: params.userId ? null : params.input.guestEmail,
      guestPhone: params.userId ? null : params.input.guestPhone,
      serviceType: params.input.serviceType,
      status: "NEW",
      propertyType: params.input.propertyType,
      location: params.input.location,
      currentElectricitySituation: params.input.currentElectricitySituation,
      estimatedMonthlyUsageKwh: params.input.estimatedMonthlyUsageKwh,
      appliances: params.input.appliances,
      desiredBackupHours: params.input.desiredBackupHours,
      existingEquipment: params.input.existingEquipment,
      budgetRange: params.input.budgetRange,
      preferredAppointmentAt: params.input.preferredAppointmentAt,
      additionalInfo: params.input.additionalInfo,
    },
    include: includePeople,
  });
}

export async function findServiceRequestById(
  id: bigint,
): Promise<ServiceRequestRow | null> {
  return db.serviceRequest.findUnique({
    where: { id },
    include: includePeople,
  });
}

export async function listServiceRequests(params: {
  limit: number;
  cursor?: string;
  status?: ServiceRequestStatus;
  serviceType?: ServiceType;
  assignedTo?: bigint;
  userId?: bigint;
}): Promise<{ rows: ServiceRequestRow[]; nextCursor: string | null }> {
  const cursor = params.cursor ? decodeCursor(params.cursor) : null;
  const rows = await db.serviceRequest.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.serviceType ? { serviceType: params.serviceType } : {}),
      ...(params.assignedTo ? { assignedTo: params.assignedTo } : {}),
      ...(params.userId ? { userId: params.userId } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
    include: includePeople,
  });
  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  return {
    rows: page,
    nextCursor:
      hasMore && page.length ? encodeCursor(page[page.length - 1]!) : null,
  };
}

export async function updateServiceRequestStatusAndAudit(params: {
  id: bigint;
  fromStatus: ServiceRequestStatus;
  toStatus: ServiceRequestStatus;
  actorId: bigint;
}): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const result = await tx.serviceRequest.updateMany({
      where: { id: params.id, status: params.fromStatus },
      data: { status: params.toStatus },
    });
    if (result.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        actorId: params.actorId,
        actorType: "USER",
        action: "service_request.status_changed",
        entityType: "service_request",
        entityId: params.id,
        beforeData: { status: params.fromStatus },
        afterData: { status: params.toStatus },
      },
    });
    return true;
  });
}

export async function assignServiceRequestAndAudit(params: {
  id: bigint;
  assignedTo: bigint | null;
  actorId: bigint;
  previousAssignedTo: bigint | null;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.serviceRequest.update({
      where: { id: params.id },
      data: { assignedTo: params.assignedTo },
    });
    await tx.auditLog.create({
      data: {
        actorId: params.actorId,
        actorType: "USER",
        action: params.assignedTo
          ? "service_request.assigned"
          : "service_request.unassigned",
        entityType: "service_request",
        entityId: params.id,
        beforeData: {
          assignedTo: params.previousAssignedTo?.toString() ?? null,
        },
        afterData: { assignedTo: params.assignedTo?.toString() ?? null },
      },
    });
  });
}
