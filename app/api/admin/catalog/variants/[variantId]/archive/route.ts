import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/catalog/schema";
import { archiveVariant } from "@/src/modules/catalog/use-cases/archive-variant";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { variantId } = await params;
    const variant = await archiveVariant(actor, idParamSchema.parse(variantId));
    revalidateCatalogProducts();
    return NextResponse.json({ variant });
  } catch (error) {
    return errorResponse(error);
  }
}
