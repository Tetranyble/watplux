import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  idParamSchema,
  updateProductImageSchema,
} from "@/src/modules/catalog/schema";
import { removeProductImage } from "@/src/modules/catalog/use-cases/remove-product-image";
import { updateProductImage } from "@/src/modules/catalog/use-cases/update-product-image";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { imageId } = await params;
    const input = updateProductImageSchema.parse(await request.json());
    const image = await updateProductImage(
      actor,
      idParamSchema.parse(imageId),
      input,
    );
    revalidateCatalogProducts();
    return NextResponse.json({ image });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { imageId } = await params;
    await removeProductImage(actor, idParamSchema.parse(imageId));
    revalidateCatalogProducts();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
