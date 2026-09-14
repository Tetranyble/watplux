import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  idParamSchema,
  requestRefundSchema,
} from "@/src/modules/payment/schema";
import { requestRefund } from "@/src/modules/payment/use-cases/request-refund";

/** Admin-only (`payments.refund`) — no customer-facing refund-request
 * flow exists anywhere in this module
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §21/§22/§30). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ paymentAttemptId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { paymentAttemptId } = await params;
    const input = requestRefundSchema.parse(await request.json());
    const refund = await requestRefund(
      actor,
      idParamSchema.parse(paymentAttemptId),
      input,
    );
    return NextResponse.json({ refund }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
