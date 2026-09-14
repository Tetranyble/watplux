import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/catalog/schema";
import { archiveProduct } from "@/src/modules/catalog/use-cases/archive-product";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { productId } = await params;
    const product = await archiveProduct(actor, idParamSchema.parse(productId));
    revalidateCatalogProducts(product.slug);
    return NextResponse.json({ product });
  } catch (error) {
    return errorResponse(error);
  }
}
