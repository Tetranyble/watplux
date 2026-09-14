import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { getSessionUser } from "@/lib/session";
import { enforcePublicRateLimit } from "@/lib/rate-limit-http";
import { createServiceRequestSchema } from "@/src/modules/service-request/schema";
import { createServiceRequest } from "@/src/modules/service-request/use-cases/create-service-request";

export async function POST(request: Request) {
  try {
    const limited = await enforcePublicRateLimit(request, {
      namespace: "service-request-create",
      windowSeconds: 600,
      max: 5,
    });
    if (limited) return limited;
    const actor = await getSessionUser();
    const input = createServiceRequestSchema.parse(await request.json());
    const serviceRequest = await createServiceRequest(actor, input);
    return NextResponse.json({ serviceRequest }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
