import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  idParamSchema,
  restockInventorySchema,
} from "@/src/modules/inventory/schema";
import { restockInventory } from "@/src/modules/inventory/use-cases/restock-inventory";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { variantId } = await params;
    const input = restockInventorySchema.parse(await request.json());
    const movement = await restockInventory(
      actor,
      idParamSchema.parse(variantId),
      input,
    );
    return NextResponse.json({ movement }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
