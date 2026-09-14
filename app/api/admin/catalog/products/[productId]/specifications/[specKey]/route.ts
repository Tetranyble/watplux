import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  idParamSchema,
  removeProductSpecificationSchema,
} from "@/src/modules/catalog/schema";
import { removeProductSpecification } from "@/src/modules/catalog/use-cases/remove-product-specification";

/** `specKey` is normalized identically by the schema's own transform
 * regardless of casing/whitespace in the URL segment, matching the
 * upsert route's own normalization (`upsertProductSpecificationSchema`). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ productId: string; specKey: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { productId, specKey } = await params;
    const input = removeProductSpecificationSchema.parse({
      productId: idParamSchema.parse(productId),
      specKey: decodeURIComponent(specKey),
    });
    await removeProductSpecification(actor, input);
    revalidateCatalogProducts();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
