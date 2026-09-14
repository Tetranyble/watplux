import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { orderNumberParamSchema } from "@/src/modules/order/schema";
import { getOrderByOrderNumber } from "@/src/modules/order/use-cases/get-order-by-order-number";

/** Useful for a post-checkout confirmation redirect that only has the
 * order number, not the numeric id (docs/PHASE_6_ORDER_PLAN.md §19).
 * Authenticated only — guest post-checkout lookup is an explicitly open
 * question (plan §17/§25), not solved here. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { orderNumber } = await params;
    const order = await getOrderByOrderNumber(
      actor,
      orderNumberParamSchema.parse(orderNumber),
    );
    return NextResponse.json({ order });
  } catch (error) {
    return errorResponse(error);
  }
}
