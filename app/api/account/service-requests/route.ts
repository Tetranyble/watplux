import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { listServiceRequestsSchema } from "@/src/modules/service-request/schema";
import { listMyServiceRequests } from "@/src/modules/service-request/use-cases/list-my-service-requests";

export async function GET(request: Request) {
  try {
    const actor = await requireSessionUser();
    const searchParams = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = listServiceRequestsSchema
      .pick({ cursor: true, limit: true })
      .parse(searchParams);
    return NextResponse.json(await listMyServiceRequests(actor, parsed));
  } catch (error) {
    return errorResponse(error);
  }
}
