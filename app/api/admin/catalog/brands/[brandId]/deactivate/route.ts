import { NextResponse } from "next/server";

import { revalidateCatalogBrands } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/catalog/schema";
import { deactivateBrand } from "@/src/modules/catalog/use-cases/deactivate-brand";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ brandId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { brandId } = await params;
    const brand = await deactivateBrand(actor, idParamSchema.parse(brandId));
    revalidateCatalogBrands(brand.slug);
    return NextResponse.json({ brand });
  } catch (error) {
    return errorResponse(error);
  }
}
