import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { getProductBySlug } from "@/src/modules/catalog/use-cases/get-product-by-slug";

/** Public product detail page data — no authentication
 * (docs/PHASE_4_CATALOG_PLAN.md §9). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const product = await getProductBySlug(slug);
    return NextResponse.json({ product });
  } catch (error) {
    return errorResponse(error);
  }
}
