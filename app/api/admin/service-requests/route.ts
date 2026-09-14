import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { listServiceRequestsSchema } from "@/src/modules/service-request/schema";
import { listServiceRequestsForAdmin } from "@/src/modules/service-request/use-cases/list-service-requests-for-admin";

export async function GET(request: Request) {
  try {
    const actor = await requireSessionUser();
    const input = listServiceRequestsSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return NextResponse.json(await listServiceRequestsForAdmin(actor, input));
  } catch (error) {
    return errorResponse(error);
  }
}
