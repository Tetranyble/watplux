import { NextResponse } from "next/server";

import { UnauthorizedError } from "@/lib/errors";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/order/schema";
import { retryPaymentSchema } from "@/src/modules/payment/schema";
import { isValidGuestOrderToken } from "@/src/modules/payment/use-cases/verify-guest-order-token";
import { retryPaymentForGuestOrder } from "@/src/modules/payment/use-cases/retry-payment-for-guest-order";
import { retryPayment } from "@/src/modules/payment/use-cases/retry-payment";

/**
 * Ownership or `orders.update` for a session — enforced inside
 * `retryPayment` itself (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §10/§22).
 * Creates a NEW payment attempt against the EXISTING order — never a new
 * order, never a new reservation.
 *
 * Additive guest path (docs/PHASE_9_STOREFRONT_PLAN.md §13.4 Option A),
 * mirroring the payment-attempts read route exactly: an optional
 * `guestToken` in the JSON body, verified before any session is
 * required. Anything that doesn't validate (missing, invalid, expired,
 * tampered, or scoped to a different order) is rejected outright rather
 * than silently falling through to the session path.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const { orderId } = await params;
    const parsedOrderId = idParamSchema.parse(orderId);
    const input = retryPaymentSchema.parse(await request.json());

    if (input.guestToken) {
      if (isValidGuestOrderToken(input.guestToken, parsedOrderId)) {
        const payment = await retryPaymentForGuestOrder(parsedOrderId);
        return NextResponse.json({ payment });
      }
      throw new UnauthorizedError("Invalid or expired access token.");
    }

    const actor = await requireSessionUser();
    const payment = await retryPayment(actor, parsedOrderId);
    return NextResponse.json({ payment });
  } catch (error) {
    return errorResponse(error);
  }
}
