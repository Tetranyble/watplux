import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/order/schema";
import { getOrderById } from "@/src/modules/order/use-cases/get-order-by-id";

/** Ownership or `orders.read` — enforced inside `getOrderById` itself. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { orderId } = await params;
    const order = await getOrderById(actor, idParamSchema.parse(orderId));
    return NextResponse.json({ order });
  } catch (error) {
    return errorResponse(error);
  }
}
