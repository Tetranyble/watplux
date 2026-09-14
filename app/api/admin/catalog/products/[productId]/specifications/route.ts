import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  idParamSchema,
  upsertProductSpecificationSchema,
} from "@/src/modules/catalog/schema";
import { upsertProductSpecification } from "@/src/modules/catalog/use-cases/upsert-product-specification";

/** `productId` always comes from the URL path, never the request body. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { productId } = await params;
    const body = await request.json();
    const input = upsertProductSpecificationSchema.parse({
      ...body,
      productId: idParamSchema.parse(productId),
    });
    const specification = await upsertProductSpecification(actor, input);
    revalidateCatalogProducts();
    return NextResponse.json({ specification }, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
