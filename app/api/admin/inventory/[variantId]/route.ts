import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/inventory/schema";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { variantId } = await params;
    const balance = await getInventoryForVariant(
      actor,
      idParamSchema.parse(variantId),
    );
    return NextResponse.json({ inventory: balance });
  } catch (error) {
    return errorResponse(error);
  }
}
