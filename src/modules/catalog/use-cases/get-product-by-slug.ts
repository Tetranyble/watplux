import { NotFoundError } from "@/lib/errors";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toProductDetail } from "@/src/modules/catalog/types";
import type { ProductDetail } from "@/src/modules/catalog/types";

/**
 * Public/customer read — no authentication requirement at all
 * (docs/PHASE_4_CATALOG_PLAN.md §9). Hard-codes the `ACTIVE`/`deletedAt:
 * null` filter and `ACTIVE`-only variants at the repo layer
 * (`findProductBySlugPublic`) — there is no parameter an unauthenticated
 * caller could pass to see a draft/archived product or an archived
 * variant. Physically separate from `getProductForAdmin`, never a shared
 * flag-branched function.
 */
export async function getProductBySlug(slug: string): Promise<ProductDetail> {
  const product = await catalogRepo.findProductBySlugPublic(slug);
  if (!product) throw new NotFoundError("Product not found.");
  return toProductDetail(product);
}
