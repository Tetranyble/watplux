import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { listRefundsForAdminSchema } from "@/src/modules/payment/schema";
import { listRefundsForAdmin } from "@/src/modules/payment/use-cases/list-refunds-for-admin";

/** Admin-wide refund queue — `payments.read`, enforced inside
 * `listRefundsForAdmin` itself (docs/PHASE_10_ADMIN_PLAN.md §14/§28.6). */
export async function GET(request: Request) {
  try {
    const actor = await requireSessionUser();
    const searchParams = new URL(request.url).searchParams;
    const input = listRefundsForAdminSchema.parse(
      Object.fromEntries(searchParams),
    );
    const page = await listRefundsForAdmin(actor, input);
    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}
