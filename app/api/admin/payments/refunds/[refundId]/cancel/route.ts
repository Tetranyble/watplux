import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  cancelRefundSchema,
  idParamSchema,
} from "@/src/modules/payment/schema";
import { cancelRefund } from "@/src/modules/payment/use-cases/cancel-refund";

/** Admin-only (`payments.refund`) — an admin deliberately aborting a
 * refund request before Paystack confirms it either way
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §18). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ refundId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { refundId } = await params;
    cancelRefundSchema.parse(await request.json());
    const refund = await cancelRefund(actor, idParamSchema.parse(refundId));
    return NextResponse.json({ refund });
  } catch (error) {
    return errorResponse(error);
  }
}
