import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { listInventorySchema } from "@/src/modules/inventory/schema";
import { listInventory } from "@/src/modules/inventory/use-cases/list-inventory";

/** Admin listing — `inventory.read`, enforced inside `listInventory` itself. */
export async function GET(request: Request) {
  try {
    const actor = await requireSessionUser();
    const searchParams = new URL(request.url).searchParams;
    const input = listInventorySchema.parse(Object.fromEntries(searchParams));
    const page = await listInventory(actor, input);
    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}
