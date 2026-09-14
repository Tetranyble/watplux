import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  idParamSchema,
  movementHistorySchema,
} from "@/src/modules/inventory/schema";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";
import { getInventoryMovementHistory } from "@/src/modules/inventory/use-cases/get-inventory-movement-history";

/** The URL is variant-scoped (matching every other route in this
 * resource); the use-case is item-scoped — resolved via
 * `getInventoryForVariant` first (also the correct `NotFoundError` for a
 * variant with no tracked inventory yet), then its `id` is used for the
 * actual history lookup. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { variantId } = await params;
    const balance = await getInventoryForVariant(
      actor,
      idParamSchema.parse(variantId),
    );

    const searchParams = new URL(request.url).searchParams;
    const input = movementHistorySchema.parse(Object.fromEntries(searchParams));
    const page = await getInventoryMovementHistory(
      actor,
      BigInt(balance.id),
      input,
    );
    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}
