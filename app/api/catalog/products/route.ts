import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  createProductSchema,
  listProductsSchema,
} from "@/src/modules/catalog/schema";
import { createProduct } from "@/src/modules/catalog/use-cases/create-product";
import { listProducts } from "@/src/modules/catalog/use-cases/list-products";

/**
 * GET is the public storefront listing — no authentication, `ACTIVE`
 * products only (docs/PHASE_4_CATALOG_PLAN.md §9). POST is the admin
 * create endpoint sharing this path; `createProduct` itself enforces
 * `products.create` internally, so an unauthenticated/under-permissioned
 * POST is rejected by the use-case, not this file.
 */
export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const input = listProductsSchema.parse(Object.fromEntries(searchParams));
    const page = await listProducts(input);
    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSessionUser();
    const input = createProductSchema.parse(await request.json());
    const product = await createProduct(actor, input);
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
