import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  idParamSchema,
  updateProductSchema,
} from "@/src/modules/catalog/schema";
import { getProductForAdmin } from "@/src/modules/catalog/use-cases/get-product-for-admin";
import { updateProduct } from "@/src/modules/catalog/use-cases/update-product";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { productId } = await params;
    const product = await getProductForAdmin(
      actor,
      idParamSchema.parse(productId),
    );
    return NextResponse.json({ product });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { productId } = await params;
    const input = updateProductSchema.parse(await request.json());
    const product = await updateProduct(
      actor,
      idParamSchema.parse(productId),
      input,
    );
    revalidateCatalogProducts(product.slug);
    return NextResponse.json({ product });
  } catch (error) {
    return errorResponse(error);
  }
}
