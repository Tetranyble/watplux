import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { listOrdersForAdminSchema } from "@/src/modules/order/schema";
import { listOrdersForAdmin } from "@/src/modules/order/use-cases/list-orders-for-admin";

/** Admin listing — `orders.read`, enforced inside `listOrdersForAdmin`
 * itself. Optionally filtered by status. */
export async function GET(request: Request) {
  try {
    const actor = await requireSessionUser();
    const searchParams = new URL(request.url).searchParams;
    const input = listOrdersForAdminSchema.parse(
      Object.fromEntries(searchParams),
    );
    const page = await listOrdersForAdmin(actor, input);
    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}
