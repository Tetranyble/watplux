import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { cancelOrderSchema, idParamSchema } from "@/src/modules/order/schema";
import { cancelOrder } from "@/src/modules/order/use-cases/cancel-order";

/** Ownership (own `PENDING_PAYMENT` order) or `orders.update` — enforced
 * inside `cancelOrder` itself. No generic status-mutation endpoint exists
 * anywhere in this module (docs/PHASE_6_ORDER_PLAN.md §16/§22) — this
 * targets exactly one transition, never an arbitrary caller-supplied
 * status. The request body is required (send `{}` if there's no note). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { orderId } = await params;
    const input = cancelOrderSchema.parse(await request.json());
    const order = await cancelOrder(actor, idParamSchema.parse(orderId), input);
    return NextResponse.json({ order });
  } catch (error) {
    return errorResponse(error);
  }
}
