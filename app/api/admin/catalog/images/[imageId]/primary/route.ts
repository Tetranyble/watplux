import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/catalog/schema";
import { setPrimaryImage } from "@/src/modules/catalog/use-cases/set-primary-image";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { imageId } = await params;
    const image = await setPrimaryImage(actor, idParamSchema.parse(imageId));
    revalidateCatalogProducts();
    return NextResponse.json({ image });
  } catch (error) {
    return errorResponse(error);
  }
}
