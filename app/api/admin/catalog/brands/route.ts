import { NextResponse } from "next/server";

import { revalidateCatalogBrands } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { createBrandSchema } from "@/src/modules/catalog/schema";
import { createBrand } from "@/src/modules/catalog/use-cases/create-brand";
import { listBrandsForAdmin } from "@/src/modules/catalog/use-cases/list-brands-for-admin";

/** Admin list read — `products.read`, includes inactive brands
 * (docs/PHASE_10_ADMIN_PLAN.md §10/§28.4 additive extension). */
export async function GET() {
  try {
    const actor = await requireSessionUser();
    const brands = await listBrandsForAdmin(actor);
    return NextResponse.json({ brands });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSessionUser();
    const input = createBrandSchema.parse(await request.json());
    const brand = await createBrand(actor, input);
    revalidateCatalogBrands(brand.slug);
    return NextResponse.json({ brand }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
