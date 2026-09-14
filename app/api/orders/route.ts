import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { listMyOrdersSchema } from "@/src/modules/order/schema";
import { listMyOrders } from "@/src/modules/order/use-cases/list-my-orders";

/**
 * Customer order collection is read-only at the HTTP boundary. New orders are
 * created only through `/api/checkout`, which owns cart resolution, inventory
 * reservation and payment-attempt creation. Keeping raw `createOrder` exposed
 * here would let callers reserve stock without traversing Checkout/Payment.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireSessionUser();
    const searchParams = new URL(request.url).searchParams;
    const input = listMyOrdersSchema.parse(Object.fromEntries(searchParams));
    const page = await listMyOrders(actor, input);
    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}
