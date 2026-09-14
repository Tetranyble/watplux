import { NextResponse } from "next/server";

import { revalidateCatalogCategories } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { idParamSchema } from "@/src/modules/catalog/schema";
import { activateCategory } from "@/src/modules/catalog/use-cases/activate-category";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ categoryId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { categoryId } = await params;
    const category = await activateCategory(
      actor,
      idParamSchema.parse(categoryId),
    );
    revalidateCatalogCategories(category.slug);
    return NextResponse.json({ category });
  } catch (error) {
    return errorResponse(error);
  }
}
