import { NextResponse } from "next/server";

import { revalidateCatalogBrands } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema, updateBrandSchema } from "@/src/modules/catalog/schema";
import { updateBrand } from "@/src/modules/catalog/use-cases/update-brand";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ brandId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { brandId } = await params;
    const input = updateBrandSchema.parse(await request.json());
    const brand = await updateBrand(actor, idParamSchema.parse(brandId), input);
    revalidateCatalogBrands(brand.slug);
    return NextResponse.json({ brand });
  } catch (error) {
    return errorResponse(error);
  }
}
