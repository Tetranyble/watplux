import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { getCategoryTree } from "@/src/modules/catalog/use-cases/get-category-tree";

/** Public category tree — no authentication (docs/PHASE_4_CATALOG_PLAN.md §9). */
export async function GET() {
  try {
    const categories = await getCategoryTree();
    return NextResponse.json({ categories });
  } catch (error) {
    return errorResponse(error);
  }
}
