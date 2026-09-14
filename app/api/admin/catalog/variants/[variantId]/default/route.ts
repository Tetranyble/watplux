import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/catalog/schema";
import { setDefaultVariant } from "@/src/modules/catalog/use-cases/set-default-variant";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { variantId } = await params;
    const variant = await setDefaultVariant(
      actor,
      idParamSchema.parse(variantId),
    );
    // Changes which price/specs the listing card shows for this product.
    revalidateCatalogProducts();
    return NextResponse.json({ variant });
  } catch (error) {
    return errorResponse(error);
  }
}
