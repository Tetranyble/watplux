import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { listBrands } from "@/src/modules/catalog/use-cases/list-brands";

/** Public brand listing — no authentication (docs/PHASE_4_CATALOG_PLAN.md §9). */
export async function GET() {
  try {
    const brands = await listBrands();
    return NextResponse.json({ brands });
  } catch (error) {
    return errorResponse(error);
  }
}
