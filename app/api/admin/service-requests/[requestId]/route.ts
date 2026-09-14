import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  assignServiceRequestSchema,
  serviceRequestAssignmentActionSchema,
  updateServiceRequestStatusSchema,
} from "@/src/modules/service-request/schema";
import {
  assignServiceRequest,
  assignServiceRequestToSelf,
} from "@/src/modules/service-request/use-cases/assign-service-request";
import { getServiceRequestForAdmin } from "@/src/modules/service-request/use-cases/get-service-request-for-admin";
import { updateServiceRequestStatus } from "@/src/modules/service-request/use-cases/update-service-request-status";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { requestId } = await params;
    return NextResponse.json(
      await getServiceRequestForAdmin(actor, BigInt(requestId)),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { requestId } = await params;
    const body = await request.json();
    if ("status" in body) {
      const input = updateServiceRequestStatusSchema.parse(body);
      await updateServiceRequestStatus(actor, BigInt(requestId), input.status);
    } else if ("assignment" in body) {
      const input = serviceRequestAssignmentActionSchema.parse(body);
      if (input.assignment === "self") {
        await assignServiceRequestToSelf(actor, BigInt(requestId));
      } else {
        await assignServiceRequest(actor, BigInt(requestId), null);
      }
    } else if ("assignedTo" in body) {
      const input = assignServiceRequestSchema.parse(body);
      await assignServiceRequest(actor, BigInt(requestId), input.assignedTo);
    } else {
      updateServiceRequestStatusSchema.parse(body);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
