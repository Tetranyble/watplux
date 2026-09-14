import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  idParamSchema,
  updateVariantSchema,
} from "@/src/modules/catalog/schema";
import { updateVariant } from "@/src/modules/catalog/use-cases/update-variant";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { variantId } = await params;
    const input = updateVariantSchema.parse(await request.json());
    const variant = await updateVariant(
      actor,
      idParamSchema.parse(variantId),
      input,
    );
    revalidateCatalogProducts();
    return NextResponse.json({ variant });
  } catch (error) {
    return errorResponse(error);
  }
}
