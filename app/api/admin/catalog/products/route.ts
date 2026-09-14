import { NextResponse } from "next/server";

import { revalidateCatalogProducts } from "@/app/_data/catalog";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  createProductSchema,
  listProductsForAdminSchema,
} from "@/src/modules/catalog/schema";
import { createProduct } from "@/src/modules/catalog/use-cases/create-product";
import { listProductsForAdmin } from "@/src/modules/catalog/use-cases/list-products-for-admin";

/** Admin listing — every status, `products.read` required, enforced
 * inside `listProductsForAdmin` itself. */
export async function GET(request: Request) {
  try {
    const actor = await requireSessionUser();
    const searchParams = new URL(request.url).searchParams;
    const input = listProductsForAdminSchema.parse(
      Object.fromEntries(searchParams),
    );
    const page = await listProductsForAdmin(actor, input);
    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}

/** `products.create`, enforced inside `createProduct` itself
 * (docs/PHASE_10_ADMIN_PLAN.md §10 — "Product create" screen's data
 * source). Always creates the product `DRAFT` with its first (default)
 * variant, matching `createProduct`'s own documented invariant. */
export async function POST(request: Request) {
  try {
    const actor = await requireSessionUser();
    const input = createProductSchema.parse(await request.json());
    const product = await createProduct(actor, input);
    revalidateCatalogProducts(product.slug);
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
