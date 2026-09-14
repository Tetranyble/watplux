import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/catalog/schema";
import { reactivateVariant } from "@/src/modules/catalog/use-cases/reactivate-variant";

/** Mirrors the sibling `archive/route.ts` exactly. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { variantId } = await params;
    const variant = await reactivateVariant(
      actor,
      idParamSchema.parse(variantId),
    );
    revalidateCatalogProducts();
    return NextResponse.json({ variant });
  } catch (error) {
    return errorResponse(error);
  }
}
