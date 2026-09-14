import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/order/schema";
import { getOrderForAdmin } from "@/src/modules/order/use-cases/get-order-for-admin";

/** Admin full-detail read — `orders.read`, enforced inside
 * `getOrderForAdmin` itself. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { orderId } = await params;
    const order = await getOrderForAdmin(actor, idParamSchema.parse(orderId));
    return NextResponse.json({ order });
  } catch (error) {
    return errorResponse(error);
  }
}
