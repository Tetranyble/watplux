import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  createVariantSchema,
  idParamSchema,
} from "@/src/modules/catalog/schema";
import { createVariant } from "@/src/modules/catalog/use-cases/create-variant";

/** `productId` always comes from the URL path, never the request body —
 * the body is merged with the path value before validation so a
 * mismatched/forged body field can never redirect the variant to a
 * different product than the URL names. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { productId } = await params;
    const body = await request.json();
    const input = createVariantSchema.parse({
      ...body,
      productId: idParamSchema.parse(productId),
    });
    const variant = await createVariant(actor, input);
    revalidateCatalogProducts();
    return NextResponse.json({ variant }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
