import { NextResponse } from "next/server";

import { revalidateCatalogCategories } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  idParamSchema,
  updateCategorySchema,
} from "@/src/modules/catalog/schema";
import { updateCategory } from "@/src/modules/catalog/use-cases/update-category";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ categoryId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { categoryId } = await params;
    const input = updateCategorySchema.parse(await request.json());
    const category = await updateCategory(
      actor,
      idParamSchema.parse(categoryId),
      input,
    );
    revalidateCatalogCategories(category.slug);
    return NextResponse.json({ category });
  } catch (error) {
    return errorResponse(error);
  }
}
