import { NextResponse } from "next/server";

import { UnauthorizedError } from "@/lib/errors";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/order/schema";
import { isValidGuestOrderToken } from "@/src/modules/payment/use-cases/verify-guest-order-token";
import { listPaymentAttemptsForGuestOrder } from "@/src/modules/payment/use-cases/list-payment-attempts-for-guest-order";
import { listPaymentAttemptsForOrder } from "@/src/modules/payment/use-cases/list-payment-attempts-for-order";

/**
 * Ownership or `payments.read` for a session — enforced inside
 * `listPaymentAttemptsForOrder` itself
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §21/§22).
 *
 * Additive guest path (docs/PHASE_9_STOREFRONT_PLAN.md §13.4 Option A): a
 * `?guestToken=` query param is verified BEFORE any session is required —
 * a valid, unexpired token scoped to this EXACT `orderId` grants access
 * via the separate, narrower `listPaymentAttemptsForGuestOrder` use-case;
 * anything else (no token, invalid, expired, tampered, or scoped to a
 * different order) falls through to the existing, completely unchanged
 * session-required path — it never silently grants broader access than a
 * real session would.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const { orderId } = await params;
    const parsedOrderId = idParamSchema.parse(orderId);

    const guestToken = new URL(request.url).searchParams.get("guestToken");
    if (guestToken) {
      if (isValidGuestOrderToken(guestToken, parsedOrderId)) {
        const attempts = await listPaymentAttemptsForGuestOrder(parsedOrderId);
        return NextResponse.json({ attempts });
      }
      // A guestToken was presented but didn't validate — reject outright
      // rather than silently falling through to the session path (which
      // would just 401 anyway for a real guest, but failing fast here
      // keeps the two paths' failure modes distinct and unambiguous for
      // the polling frontend).
      throw new UnauthorizedError("Invalid or expired access token.");
    }

    const actor = await requireSessionUser();
    const attempts = await listPaymentAttemptsForOrder(actor, parsedOrderId);
    return NextResponse.json({ attempts });
  } catch (error) {
    return errorResponse(error);
  }
}
