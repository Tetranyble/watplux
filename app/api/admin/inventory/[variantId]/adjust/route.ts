import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  adjustInventorySchema,
  idParamSchema,
} from "@/src/modules/inventory/schema";
import { adjustInventory } from "@/src/modules/inventory/use-cases/adjust-inventory";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { variantId } = await params;
    const input = adjustInventorySchema.parse(await request.json());
    const movement = await adjustInventory(
      actor,
      idParamSchema.parse(variantId),
      input,
    );
    return NextResponse.json({ movement }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
