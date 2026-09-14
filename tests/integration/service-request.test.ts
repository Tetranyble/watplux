import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import {
  assignSeededRole,
  cleanupTestData,
  createTestUser,
  resolveTestUser,
} from "@/tests/integration/helpers/fixtures";
import { createServiceRequest } from "@/src/modules/service-request/use-cases/create-service-request";
import { getServiceRequest } from "@/src/modules/service-request/use-cases/get-service-request";
import { getServiceRequestForAdmin } from "@/src/modules/service-request/use-cases/get-service-request-for-admin";
import { listServiceRequestsForAdmin } from "@/src/modules/service-request/use-cases/list-service-requests-for-admin";
import { updateServiceRequestStatus } from "@/src/modules/service-request/use-cases/update-service-request-status";
import { assignServiceRequestToSelf } from "@/src/modules/service-request/use-cases/assign-service-request";

async function cleanup() {
  await db.auditLog.deleteMany({ where: { entityType: "service_request" } });
  await db.serviceRequest.deleteMany();
  await cleanupTestData();
}

async function createActor(role?: "staff" | "super_admin") {
  const account = await createTestUser();
  if (role) {
    await assignSeededRole(account.user.id, role);
    return (await resolveTestUser(account.email)).user;
  }
  return account.user;
}

const requestInput = {
  serviceType: "CONSULTATION" as const,
  propertyType: "RESIDENTIAL" as const,
  location: "Lekki, Lagos",
  appliances: "2 ACs, fridge, freezer and lighting",
  desiredBackupHours: 8,
};

describe("service request domain", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("creates an authenticated request linked to the customer", async () => {
    const customer = await createActor();
    const created = await createServiceRequest(customer, requestInput);
    expect(created.userId).toBe(customer.id.toString());
    expect(created.status).toBe("NEW");
    expect(created.requesterEmail).toBe(customer.email);
  });

  it("requires identity fields for guest requests", async () => {
    await expect(
      createServiceRequest(null, requestInput),
    ).rejects.toBeInstanceOf(ValidationError);
    const created = await createServiceRequest(null, {
      ...requestInput,
      guestName: "Guest Customer",
      guestEmail: "guest-service@example.test",
      guestPhone: "+2348012345678",
    });
    expect(created.userId).toBeNull();
    expect(created.requesterName).toBe("Guest Customer");
  });

  it("enforces owner versus operator read boundaries", async () => {
    const owner = await createActor();
    const other = await createActor();
    const staff = await createActor("staff");
    const created = await createServiceRequest(owner, requestInput);

    await expect(
      getServiceRequest(other, BigInt(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getServiceRequest(owner, BigInt(created.id))).id).toBe(
      created.id,
    );
    expect(
      (await getServiceRequestForAdmin(staff, BigInt(created.id))).id,
    ).toBe(created.id);
  });

  it("lets staff triage, self-assign and progress requests through named transitions", async () => {
    const customer = await createActor();
    const staff = await createActor("staff");
    const created = await createServiceRequest(customer, requestInput);

    await assignServiceRequestToSelf(staff, BigInt(created.id));
    await updateServiceRequestStatus(staff, BigInt(created.id), "CONTACTED");
    await updateServiceRequestStatus(staff, BigInt(created.id), "SCHEDULED");

    const updated = await getServiceRequestForAdmin(staff, BigInt(created.id));
    expect(updated.assignedTo).toBe(staff.id.toString());
    expect(updated.status).toBe("SCHEDULED");
  });

  it("rejects invalid status jumps and customer admin listing", async () => {
    const customer = await createActor();
    const created = await createServiceRequest(customer, requestInput);
    await expect(
      updateServiceRequestStatus(customer, BigInt(created.id), "COMPLETED"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      listServiceRequestsForAdmin(customer, { limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
