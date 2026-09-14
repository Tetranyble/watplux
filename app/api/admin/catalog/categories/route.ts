import { NextResponse } from "next/server";

import { revalidateCatalogCategories } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { createCategorySchema } from "@/src/modules/catalog/schema";
import { createCategory } from "@/src/modules/catalog/use-cases/create-category";
import { getCategoryTreeForAdmin } from "@/src/modules/catalog/use-cases/get-category-tree-for-admin";

/** Admin tree read — `products.read`, includes inactive categories
 * (docs/PHASE_10_ADMIN_PLAN.md §10/§28.4 additive extension). */
export async function GET() {
  try {
    const actor = await requireSessionUser();
    const categories = await getCategoryTreeForAdmin(actor);
    return NextResponse.json({ categories });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSessionUser();
    const input = createCategorySchema.parse(await request.json());
    const category = await createCategory(actor, input);
    revalidateCatalogCategories(category.slug);
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
