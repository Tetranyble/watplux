import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  addProductImageSchema,
  idParamSchema,
} from "@/src/modules/catalog/schema";
import { addProductImage } from "@/src/modules/catalog/use-cases/add-product-image";

/** `productId` always comes from the URL path, never the request body —
 * same pattern as the variants-creation route. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { productId } = await params;
    const body = await request.json();
    const input = addProductImageSchema.parse({
      ...body,
      productId: idParamSchema.parse(productId),
    });
    const image = await addProductImage(actor, input);
    // Parent product's slug isn't part of `CatalogImage` — bust the
    // coarse `catalog:products` tag, which also invalidates every
    // product's PDP cache (see revalidateCatalogProducts' own comment).
    revalidateCatalogProducts();
    return NextResponse.json({ image }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
