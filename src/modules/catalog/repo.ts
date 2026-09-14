import { Prisma } from "@prisma/client";
import type { Product, ProductVariant } from "@prisma/client";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { pickReplacementDefault } from "@/src/modules/catalog/default-variant";
import { slugify, suffixSlug } from "@/src/modules/catalog/slug";
import { MAX_SLUG_GENERATION_ATTEMPTS } from "@/src/modules/catalog/constants";

/**
 * Data access layer — the only file in this module allowed to import the
 * Prisma client, per docs/ARCHITECTURE.md §1. Every `$transaction`
 * boundary named in docs/PHASE_4_CATALOG_PLAN.md §13/§13a lives here.
 */

type TransactionClient = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Shared helpers: unique-constraint detection, slug resolution, row locking
// ---------------------------------------------------------------------------

/** Prisma's P2002 error on MySQL reports `meta.target` as a single string
 * (the index name, e.g. `"products_slug_key"`), not an array — confirmed
 * empirically against this project's actual database, not assumed from
 * documentation written for other connectors. */
function isUniqueConstraintViolation(
  error: unknown,
  fieldNameHint: string,
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const target = error.meta?.target;
  return typeof target === "string" && target.includes(fieldNameHint);
}

/**
 * Resolves the two-path slug semantics from docs/PHASE_4_CATALOG_PLAN.md
 * §11: an explicit slug is attempted exactly once and any conflict is a
 * hard `ConflictError`; an omitted slug is derived from `nameForSlug` and
 * retried with `-2`, `-3`, ... suffixes on conflict, each attempt its own
 * transaction (never one transaction spanning all retries).
 */
async function resolveSlugAndWrite<T>(params: {
  explicitSlug: string | undefined;
  nameForSlug: string;
  attemptWrite: (slug: string) => Promise<T>;
}): Promise<T> {
  if (params.explicitSlug !== undefined) {
    try {
      return await params.attemptWrite(params.explicitSlug);
    } catch (error) {
      if (isUniqueConstraintViolation(error, "slug")) {
        throw new ConflictError(
          `The slug "${params.explicitSlug}" is already in use.`,
        );
      }
      throw error;
    }
  }

  const baseSlug = slugify(params.nameForSlug);
  for (let attempt = 1; attempt <= MAX_SLUG_GENERATION_ATTEMPTS; attempt++) {
    const candidateSlug = suffixSlug(baseSlug, attempt);
    try {
      return await params.attemptWrite(candidateSlug);
    } catch (error) {
      const isLastAttempt = attempt === MAX_SLUG_GENERATION_ATTEMPTS;
      if (isUniqueConstraintViolation(error, "slug") && !isLastAttempt) {
        continue;
      }
      if (isUniqueConstraintViolation(error, "slug")) {
        throw new ConflictError(
          "Could not generate a unique slug after multiple attempts.",
        );
      }
      throw error;
    }
  }
  // Unreachable (the loop always returns or throws), but TypeScript's
  // control-flow analysis can't see that through the try/catch.
  throw new ConflictError(
    "Could not generate a unique slug after multiple attempts.",
  );
}

/**
 * The explicit row lock from docs/PHASE_4_CATALOG_PLAN.md §13a — a MySQL
 * locking read (`SELECT ... FOR UPDATE`) on the parent `products` row,
 * acquired as the FIRST statement inside a transaction, before any read
 * of that product's variants. Unlike a plain `SELECT`, this does not use
 * the transaction's `REPEATABLE READ` snapshot: it reads the latest
 * committed row and blocks any other transaction's own `FOR UPDATE`
 * against the same row until this one commits or rolls back. This is
 * what makes `publishProduct`/`archiveVariant`/`setDefaultVariant` safe
 * against each other under real concurrency — see §13a for the full
 * worked example of the race this closes.
 */
async function lockProductRow(
  tx: TransactionClient,
  productId: bigint,
): Promise<void> {
  const rows = await tx.$queryRaw<
    { id: bigint }[]
  >`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
  if (rows.length === 0) {
    throw new NotFoundError("Product not found.");
  }
}

const PRODUCT_DETAIL_INCLUDE = {
  brand: true,
  category: true,
  variants: { orderBy: { sortOrder: "asc" as const } },
  images: { orderBy: { sortOrder: "asc" as const } },
  specifications: { orderBy: { sortOrder: "asc" as const } },
};

const PRODUCT_SUMMARY_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  isFeatured: true,
  createdAt: true,
  brand: { select: { id: true, name: true, slug: true } },
  category: { select: { id: true, name: true, slug: true } },
} as const;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface FirstVariantData {
  sku: string;
  variantLabel?: string;
  optionValues?: Record<string, string>;
  priceMinor: number;
  compareAtPriceMinor?: number | null;
  sortOrder?: number;
  powerRatingW?: number;
  voltageV?: number;
  capacityWh?: number;
  ratedCurrentA?: number;
  phase?: "SINGLE" | "THREE";
  efficiencyPercent?: number;
  mpptMinV?: number;
  mpptMaxV?: number;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

export interface CreateProductData {
  name: string;
  slug?: string;
  shortDescription?: string;
  description?: string;
  unitOfMeasure: "EACH" | "METER";
  categoryId: bigint;
  brandId?: bigint | null;
  warrantyMonths?: number;
  isFeatured: boolean;
  seoTitle?: string;
  seoDescription?: string;
  variant: FirstVariantData;
}

/** Creates a product and its first (default) variant in one transaction —
 * the "at least one variant, exactly one default" half of the invariant
 * (docs/PHASE_4_CATALOG_PLAN.md §4). Slug resolution wraps the whole
 * transaction per attempt (§11). */
export async function createProductWithFirstVariant(
  data: CreateProductData,
): Promise<Product & { variants: ProductVariant[] }> {
  return resolveSlugAndWrite({
    explicitSlug: data.slug,
    nameForSlug: data.name,
    attemptWrite: (slug) =>
      db.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            name: data.name,
            slug,
            shortDescription: data.shortDescription,
            description: data.description,
            unitOfMeasure: data.unitOfMeasure,
            categoryId: data.categoryId,
            brandId: data.brandId ?? null,
            warrantyMonths: data.warrantyMonths,
            isFeatured: data.isFeatured,
            seoTitle: data.seoTitle,
            seoDescription: data.seoDescription,
            status: "DRAFT",
          },
        });

        let variant: ProductVariant;
        try {
          variant = await tx.productVariant.create({
            data: {
              productId: product.id,
              sku: data.variant.sku,
              variantLabel: data.variant.variantLabel,
              optionValues: data.variant.optionValues,
              priceMinor: data.variant.priceMinor,
              compareAtPriceMinor: data.variant.compareAtPriceMinor,
              sortOrder: data.variant.sortOrder ?? 0,
              powerRatingW: data.variant.powerRatingW,
              voltageV: data.variant.voltageV,
              capacityWh: data.variant.capacityWh,
              ratedCurrentA: data.variant.ratedCurrentA,
              phase: data.variant.phase,
              efficiencyPercent: data.variant.efficiencyPercent,
              mpptMinV: data.variant.mpptMinV,
              mpptMaxV: data.variant.mpptMaxV,
              weightKg: data.variant.weightKg,
              lengthCm: data.variant.lengthCm,
              widthCm: data.variant.widthCm,
              heightCm: data.variant.heightCm,
              isDefault: true,
              status: "ACTIVE",
            },
          });
        } catch (error) {
          if (isUniqueConstraintViolation(error, "sku")) {
            throw new ConflictError(
              `SKU "${data.variant.sku}" is already in use.`,
            );
          }
          throw error;
        }

        return { ...product, variants: [variant] };
      }),
  });
}

export interface UpdateProductData {
  name?: string;
  slug?: string;
  shortDescription?: string | null;
  description?: string | null;
  unitOfMeasure?: "EACH" | "METER";
  categoryId?: bigint;
  brandId?: bigint | null;
  warrantyMonths?: number | null;
  isFeatured?: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export async function updateProduct(
  productId: bigint,
  data: UpdateProductData,
): Promise<Product> {
  return resolveSlugAndWrite({
    explicitSlug: data.slug,
    nameForSlug: data.name ?? "",
    attemptWrite: (slug) =>
      db.product.update({
        where: { id: productId },
        data: {
          name: data.name,
          // Only overwrite the slug if one was actually resolved for this
          // call (an explicit slug, or an auto-derived one because the
          // name changed) — resolveSlugAndWrite always calls attemptWrite
          // with *some* slug, so the caller distinguishes "no slug change
          // intended" upstream (see update-product.ts use-case).
          slug:
            data.slug !== undefined || data.name !== undefined
              ? slug
              : undefined,
          shortDescription: data.shortDescription,
          description: data.description,
          unitOfMeasure: data.unitOfMeasure,
          categoryId: data.categoryId,
          brandId: data.brandId,
          warrantyMonths: data.warrantyMonths,
          isFeatured: data.isFeatured,
          seoTitle: data.seoTitle,
          seoDescription: data.seoDescription,
        },
      }),
  });
}

export async function findProductById(productId: bigint) {
  return db.product.findUnique({
    where: { id: productId },
    include: PRODUCT_DETAIL_INCLUDE,
  });
}

export async function findProductBySlugPublic(slug: string) {
  return db.product.findFirst({
    where: { slug, status: "ACTIVE", deletedAt: null },
    include: {
      brand: true,
      category: true,
      variants: {
        where: { status: "ACTIVE" },
        orderBy: { sortOrder: "asc" },
      },
      images: { orderBy: { sortOrder: "asc" } },
      specifications: { orderBy: { sortOrder: "asc" } },
    },
  });
}

/** Re-reads a product's `ACTIVE` variants inside an already-locked
 * transaction (§13a) — never called outside a transaction that has
 * already called `lockProductRow` for this exact `productId`. */
async function getActiveVariantsForUpdate(
  tx: TransactionClient,
  productId: bigint,
) {
  return tx.productVariant.findMany({
    where: { productId, status: "ACTIVE" },
    select: { id: true, sortOrder: true, isDefault: true },
  });
}

/** Publishes (or re-publishes) a product — locks the product row first
 * (§13a), re-reads the variant set against that lock, and only then
 * validates/writes, so a concurrent `archiveVariant` on the same product
 * can never slip in between the check and the write. */
export async function publishProduct(productId: bigint): Promise<Product> {
  return db.$transaction(async (tx) => {
    await lockProductRow(tx, productId);

    const activeVariants = await getActiveVariantsForUpdate(tx, productId);
    const hasActiveDefault = activeVariants.some((v) => v.isDefault);
    if (activeVariants.length === 0 || !hasActiveDefault) {
      throw new ValidationError(
        "This product cannot be published: it has no ACTIVE variant flagged as the default.",
      );
    }

    return tx.product.update({
      where: { id: productId },
      data: { status: "ACTIVE" },
    });
  });
}

export async function archiveProduct(productId: bigint): Promise<Product> {
  return db.product.update({
    where: { id: productId },
    data: { status: "ARCHIVED" },
  });
}

export async function softDeleteProduct(productId: bigint): Promise<Product> {
  return db.product.update({
    where: { id: productId },
    data: { deletedAt: new Date() },
  });
}

export async function restoreProduct(productId: bigint): Promise<Product> {
  return db.product.update({
    where: { id: productId },
    data: { deletedAt: null },
  });
}

export interface CursorInput {
  createdAt: Date;
  id: bigint;
  /** Only present/meaningful when the listing's `sortBy` is `"featured"`
   * (docs/PHASE_9_STOREFRONT_PLAN.md §9) — carries the cursor row's own
   * `isFeatured` value so keyset pagination can resume correctly across
   * the featured/non-featured boundary, not just within one group. */
  isFeatured?: boolean;
  /** Default-variant price carried only for price-sorted listings. */
  priceMinor?: number;
}

export function encodeProductCursor(cursor: CursorInput): string {
  const isFeaturedPart =
    cursor.isFeatured === undefined ? "" : cursor.isFeatured ? "1" : "0";
  const pricePart =
    cursor.priceMinor === undefined ? "" : String(cursor.priceMinor);
  return Buffer.from(
    `${cursor.createdAt.toISOString()}|${cursor.id}|${isFeaturedPart}|${pricePart}`,
  ).toString("base64url");
}

export function decodeProductCursor(raw: string): CursorInput | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const [isoDate, idString, isFeaturedPart, pricePart] = decoded.split("|");
    if (!isoDate || !idString) return null;
    const createdAt = new Date(isoDate);
    if (Number.isNaN(createdAt.getTime())) return null;
    return {
      createdAt,
      id: BigInt(idString),
      isFeatured:
        isFeaturedPart === "1"
          ? true
          : isFeaturedPart === "0"
            ? false
            : undefined,
      priceMinor:
        pricePart !== undefined &&
        pricePart !== "" &&
        Number.isSafeInteger(Number(pricePart))
          ? Number(pricePart)
          : undefined,
    };
  } catch {
    return null;
  }
}

export interface ListProductsFilters {
  categoryId?: bigint;
  brandId?: bigint;
  featured?: boolean;
  search?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  includeDeleted?: boolean;
  cursor?: CursorInput;
  limit: number;
  // --- Phase 9 additive extensions (docs/PHASE_9_STOREFRONT_PLAN.md §9/§31) ---
  // All optional; omitting every one of them reproduces the exact prior
  // behavior for every existing caller (admin listing, Phase 4 tests).
  /** Matches against ANY of the product's variants' `priceMinor` (not
   * necessarily its default variant) — a product can appear in a price
   * range via a non-default variant, a disclosed MVP nuance (plan §9). */
  minPriceMinor?: number;
  maxPriceMinor?: number;
  powerRatingWMin?: number;
  powerRatingWMax?: number;
  voltageV?: number;
  phase?: "SINGLE" | "THREE";
  /** Require at least one ACTIVE variant matching the selected facets to have
   * positive live availability. This composes with the same variant predicate
   * rather than checking an unrelated variant. */
  inStockOnly?: boolean;
  /** All four modes use keyset pagination. Price ordering uses the product's
   * default variant price as the merchandising price, with productId as the
   * deterministic tie-breaker. */
  sortBy?: "newest" | "featured" | "price_asc" | "price_desc";
}

function buildVariantFacetFilter(
  filters: ListProductsFilters,
  publicOnly: boolean,
): Prisma.ProductVariantWhereInput | null {
  const facet: Prisma.ProductVariantWhereInput = {};
  if (publicOnly) {
    facet.status = "ACTIVE";
  }
  if (
    filters.minPriceMinor !== undefined ||
    filters.maxPriceMinor !== undefined
  ) {
    facet.priceMinor = {
      ...(filters.minPriceMinor !== undefined
        ? { gte: filters.minPriceMinor }
        : {}),
      ...(filters.maxPriceMinor !== undefined
        ? { lte: filters.maxPriceMinor }
        : {}),
    };
  }
  if (
    filters.powerRatingWMin !== undefined ||
    filters.powerRatingWMax !== undefined
  ) {
    facet.powerRatingW = {
      ...(filters.powerRatingWMin !== undefined
        ? { gte: filters.powerRatingWMin }
        : {}),
      ...(filters.powerRatingWMax !== undefined
        ? { lte: filters.powerRatingWMax }
        : {}),
    };
  }
  if (filters.voltageV !== undefined) {
    facet.voltageV = filters.voltageV;
  }
  if (filters.phase !== undefined) {
    facet.phase = filters.phase;
  }
  if (filters.inStockOnly) {
    facet.inventoryItem = {
      is: { quantityAvailable: { gt: 0 } },
    };
  }

  // `facet` having only the (public-only) status key means no actual
  // filter was requested — don't add a no-op `variants: { some: {...} } }`
  // clause that would incorrectly exclude products with zero variants
  // matching just the status condition alone in edge cases.
  const meaningfulKeyCount = Object.keys(facet).filter(
    (k) => k !== "status",
  ).length;
  return meaningfulKeyCount > 0 ? facet : null;
}

/** Builds the cursor's `OR` condition for the active sort order — a plain
 * 2-level `(createdAt, id)` keyset for `"newest"`, or a 3-level
 * `(isFeatured, createdAt, id)` keyset for `"featured"` (Prisma's
 * `BoolFilter` has no `lt`, so the "isFeatured strictly less than a true
 * cursor" branch is expressed directly as `{ isFeatured: false }` — the
 * only way a boolean can be "less than" `true`). */
function buildCursorCondition(
  cursor: CursorInput,
  sortBy: "newest" | "featured",
): Prisma.ProductWhereInput {
  if (sortBy === "featured") {
    const isFeaturedCursor = cursor.isFeatured ?? false;
    return {
      OR: [
        ...(isFeaturedCursor ? [{ isFeatured: false }] : []),
        { isFeatured: isFeaturedCursor, createdAt: { lt: cursor.createdAt } },
        {
          isFeatured: isFeaturedCursor,
          createdAt: cursor.createdAt,
          id: { lt: cursor.id },
        },
      ],
    };
  }
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

async function listProducts(filters: ListProductsFilters, publicOnly: boolean) {
  const sortBy = filters.sortBy ?? "newest";
  const variantFacetFilter = buildVariantFacetFilter(filters, publicOnly);
  const searchTerms = filters.search
    ?.split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 6);

  const baseWhere: Prisma.ProductWhereInput = {
    ...(publicOnly
      ? { status: "ACTIVE", deletedAt: null }
      : {
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.includeDeleted ? {} : { deletedAt: null }),
        }),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
    ...(filters.featured !== undefined ? { isFeatured: filters.featured } : {}),
    ...(searchTerms?.length
      ? {
          AND: searchTerms.map((term) => ({
            OR: [
              { name: { contains: term } },
              { shortDescription: { contains: term } },
              { brand: { is: { name: { contains: term } } } },
              { category: { is: { name: { contains: term } } } },
              {
                variants: {
                  some: {
                    ...(publicOnly ? { status: "ACTIVE" as const } : {}),
                    OR: [
                      { sku: { contains: term } },
                      { variantLabel: { contains: term } },
                    ],
                  },
                },
              },
            ],
          })),
        }
      : {}),
    ...(variantFacetFilter ? { variants: { some: variantFacetFilter } } : {}),
  };

  // Price ordering is performed through the default-variant relation. Prisma
  // cannot order a Product by an arbitrary field of a to-many relation, so a
  // first keyset query resolves the ordered product IDs and a second query
  // hydrates the existing ProductSummary shape. This stays deterministic and
  // avoids OFFSET while keeping Product.price denormalization out of the schema.
  if (sortBy === "price_asc" || sortBy === "price_desc") {
    const direction = sortBy === "price_asc" ? "asc" : "desc";
    const priceCursor = filters.cursor?.priceMinor;
    const idCursor = filters.cursor?.id;
    const orderedVariants = await db.productVariant.findMany({
      where: {
        isDefault: true,
        ...(publicOnly ? { status: "ACTIVE" } : {}),
        product: { is: baseWhere },
        ...(priceCursor !== undefined && idCursor !== undefined
          ? {
              OR: [
                {
                  priceMinor:
                    direction === "asc"
                      ? { gt: priceCursor }
                      : { lt: priceCursor },
                },
                {
                  priceMinor: priceCursor,
                  productId:
                    direction === "asc" ? { gt: idCursor } : { lt: idCursor },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ priceMinor: direction }, { productId: direction }],
      take: filters.limit + 1,
      select: { productId: true, priceMinor: true },
    });

    const hasNextPage = orderedVariants.length > filters.limit;
    const pageVariants = hasNextPage
      ? orderedVariants.slice(0, filters.limit)
      : orderedVariants;
    if (pageVariants.length === 0) return { rows: [], nextCursor: null };

    const ids = pageVariants.map((row) => row.productId);
    const hydrated = await db.product.findMany({
      where: { id: { in: ids } },
      select: {
        ...PRODUCT_SUMMARY_SELECT,
        images: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
          take: 1,
          select: { url: true, altText: true },
        },
        variants: {
          where: {
            isDefault: true,
            ...(publicOnly ? { status: "ACTIVE" } : {}),
          },
          take: 1,
          select: {
            id: true,
            sku: true,
            priceMinor: true,
            compareAtPriceMinor: true,
            currency: true,
          },
        },
      },
    });
    const byId = new Map(hydrated.map((row) => [row.id.toString(), row]));
    const rows = ids
      .map((id) => byId.get(id.toString()))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const lastVariant = pageVariants[pageVariants.length - 1];
    const lastProduct = lastVariant
      ? byId.get(lastVariant.productId.toString())
      : undefined;
    const nextCursor =
      hasNextPage && lastVariant && lastProduct
        ? encodeProductCursor({
            createdAt: lastProduct.createdAt,
            id: lastVariant.productId,
            priceMinor: lastVariant.priceMinor,
          })
        : null;
    return { rows, nextCursor };
  }

  const where: Prisma.ProductWhereInput = {
    ...baseWhere,
    ...(filters.cursor ? buildCursorCondition(filters.cursor, sortBy) : {}),
  };

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    sortBy === "featured"
      ? [{ isFeatured: "desc" }, { createdAt: "desc" }, { id: "desc" }]
      : [{ createdAt: "desc" }, { id: "desc" }];

  const rows = await db.product.findMany({
    where,
    orderBy,
    take: filters.limit + 1,
    select: {
      ...PRODUCT_SUMMARY_SELECT,
      images: {
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
        take: 1,
        select: { url: true, altText: true },
      },
      variants: {
        where: { isDefault: true, ...(publicOnly ? { status: "ACTIVE" } : {}) },
        take: 1,
        select: {
          id: true,
          sku: true,
          priceMinor: true,
          compareAtPriceMinor: true,
          currency: true,
        },
      },
    },
  });

  const hasNextPage = rows.length > filters.limit;
  const pageRows = hasNextPage ? rows.slice(0, filters.limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasNextPage && lastRow
      ? encodeProductCursor({
          createdAt: lastRow.createdAt,
          id: lastRow.id,
          isFeatured: sortBy === "featured" ? lastRow.isFeatured : undefined,
        })
      : null;

  return { rows: pageRows, nextCursor };
}

export async function listProductsPublic(filters: ListProductsFilters) {
  return listProducts(filters, true);
}

export async function listProductsForAdmin(filters: ListProductsFilters) {
  return listProducts(filters, false);
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export async function findVariantById(variantId: bigint) {
  return db.productVariant.findUnique({ where: { id: variantId } });
}

export interface CreateVariantData {
  productId: bigint;
  sku: string;
  variantLabel?: string;
  optionValues?: Record<string, string>;
  priceMinor: number;
  compareAtPriceMinor?: number | null;
  sortOrder?: number;
  powerRatingW?: number;
  voltageV?: number;
  capacityWh?: number;
  ratedCurrentA?: number;
  phase?: "SINGLE" | "THREE";
  efficiencyPercent?: number;
  mpptMinV?: number;
  mpptMaxV?: number;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

/** Always `isDefault: false` — never a side door for changing the
 * default (docs/PHASE_4_CATALOG_PLAN.md §4). No product-row lock needed:
 * this can only ever add to the `ACTIVE` set (§13a). */
export async function createVariant(
  data: CreateVariantData,
): Promise<ProductVariant> {
  try {
    return await db.productVariant.create({
      data: {
        productId: data.productId,
        sku: data.sku,
        variantLabel: data.variantLabel,
        optionValues: data.optionValues,
        priceMinor: data.priceMinor,
        compareAtPriceMinor: data.compareAtPriceMinor,
        sortOrder: data.sortOrder ?? 0,
        powerRatingW: data.powerRatingW,
        voltageV: data.voltageV,
        capacityWh: data.capacityWh,
        ratedCurrentA: data.ratedCurrentA,
        phase: data.phase,
        efficiencyPercent: data.efficiencyPercent,
        mpptMinV: data.mpptMinV,
        mpptMaxV: data.mpptMaxV,
        weightKg: data.weightKg,
        lengthCm: data.lengthCm,
        widthCm: data.widthCm,
        heightCm: data.heightCm,
        isDefault: false,
        status: "ACTIVE",
      },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error, "sku")) {
      throw new ConflictError(`SKU "${data.sku}" is already in use.`);
    }
    throw error;
  }
}

export interface UpdateVariantData {
  sku?: string;
  variantLabel?: string | null;
  optionValues?: Record<string, string> | null;
  priceMinor?: number;
  compareAtPriceMinor?: number | null;
  sortOrder?: number;
  powerRatingW?: number | null;
  voltageV?: number | null;
  capacityWh?: number | null;
  ratedCurrentA?: number | null;
  phase?: "SINGLE" | "THREE" | null;
  efficiencyPercent?: number | null;
  mpptMinV?: number | null;
  mpptMaxV?: number | null;
  weightKg?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

/** Never touches `status`/`isDefault` — no product-row lock needed (§13a). */
export async function updateVariant(
  variantId: bigint,
  data: UpdateVariantData,
): Promise<ProductVariant> {
  try {
    return await db.productVariant.update({
      where: { id: variantId },
      data: {
        ...data,
        // Prisma requires the `Prisma.JsonNull` sentinel to clear a JSON
        // column — a plain `null` is only valid for genuinely nullable
        // scalar columns, not JSON ones.
        optionValues:
          data.optionValues === null ? Prisma.JsonNull : data.optionValues,
      },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error, "sku")) {
      throw new ConflictError(`SKU "${data.sku}" is already in use.`);
    }
    throw error;
  }
}

/**
 * Pre-transaction lookup of *only* `productId` — the one field that's
 * immutable once a variant is created, so reading it before the lock is
 * safe. Every other field (`status`, `isDefault`, ...) is re-read AFTER
 * the lock is held (§13a) and is what every invariant decision below is
 * actually based on — never this lookup.
 *
 * Deliberately runs on `db` (its own implicit, immediately-committed
 * transaction), NOT on the `tx` of the caller's later `db.$transaction`.
 * An earlier version of this function ran as `tx.productVariant.findUnique(...)`
 * — a plain (non-locking) read — as the FIRST statement inside the same
 * transaction that later calls `lockProductRow`. Under MySQL's
 * `REPEATABLE READ` (the default), a transaction's consistent-read
 * snapshot is established at its FIRST plain read, not reset by a later
 * locking read (`FOR UPDATE`) — so that ordering silently poisoned every
 * subsequent plain read in the SAME transaction (including the "read the
 * ACTIVE variant set" step §13a depends on) with a snapshot taken
 * *before* the lock was ever acquired, defeating the entire point of
 * locking. Confirmed empirically: two genuinely concurrent
 * `archiveVariant` calls on a product's only two `ACTIVE` variants both
 * succeeded, each seeing the other's variant as still `ACTIVE` in its own
 * stale snapshot. Moving this lookup to its own separate,
 * already-committed-by-the-time-it-returns query removes it from the
 * later transaction's snapshot lineage entirely — the transaction's FIRST
 * statement is now the `FOR UPDATE` lock itself, exactly as §13a
 * requires. See docs/PHASE_4_CATALOG_IMPLEMENTATION.md for the full
 * account of this bug and fix.
 */
async function findVariantProductId(variantId: bigint): Promise<bigint> {
  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    select: { productId: true },
  });
  if (!variant) {
    throw new NotFoundError("Variant not found.");
  }
  return variant.productId;
}

/** The exact two-statement unset-then-set from
 * docs/PHASE_4_CATALOG_PLAN.md §4/§13a: locks the product row first, then
 * re-reads before unsetting the old default and setting the new one —
 * serializes against a concurrent `archiveVariant` on the same product.
 * Refuses to make an `ARCHIVED` variant the default (re-checked against
 * the post-lock state, not the pre-transaction lookup above). */
export async function setDefaultVariant(
  variantId: bigint,
): Promise<ProductVariant> {
  const productId = await findVariantProductId(variantId);

  return db.$transaction(async (tx) => {
    await lockProductRow(tx, productId);

    const currentVariant = await tx.productVariant.findUniqueOrThrow({
      where: { id: variantId },
    });
    if (currentVariant.status !== "ACTIVE") {
      throw new ValidationError(
        "Cannot set an ARCHIVED variant as the product's default. Reactivate it first.",
      );
    }

    await tx.productVariant.updateMany({
      where: { productId, isDefault: true },
      data: { isDefault: false },
    });
    return tx.productVariant.update({
      where: { id: variantId },
      data: { isDefault: true },
    });
  });
}

/**
 * Archives a variant, locking the product row first (§13a) so the
 * "is this the last ACTIVE variant / does it hold the default" check is
 * always answered against fresh, post-lock state — never the pre-lock
 * lookup above. If the archived variant held the default, promotes a
 * replacement from the remaining `ACTIVE` variants
 * (docs/PHASE_4_CATALOG_PLAN.md §4's pure selection function). Throws if
 * archiving would leave zero `ACTIVE` variants. Archiving an
 * already-`ARCHIVED` variant is a harmless idempotent no-op (matching
 * `reactivateVariant`'s own idempotency in the other direction) — it
 * never appears in the post-lock `ACTIVE` set, so it can't be "the last
 * one" and never held a default (a default is always `ACTIVE` by
 * construction, enforced by `setDefaultVariant` above).
 */
export async function archiveVariant(
  variantId: bigint,
): Promise<ProductVariant> {
  const productId = await findVariantProductId(variantId);

  return db.$transaction(async (tx) => {
    await lockProductRow(tx, productId);

    const activeVariants = await getActiveVariantsForUpdate(tx, productId);
    const targetActiveEntry = activeVariants.find((v) => v.id === variantId);
    const remainingActive = activeVariants.filter((v) => v.id !== variantId);

    if (targetActiveEntry !== undefined && remainingActive.length === 0) {
      throw new ValidationError(
        "Cannot archive the last ACTIVE variant of a product. Archive the product itself first, or leave this variant active.",
      );
    }

    const wasDefault = targetActiveEntry?.isDefault ?? false;

    // Archiving alone does not affect `defaultVariantKey` (the generated
    // column keys off `is_default`, not `status`) — if this variant held
    // the default, `isDefault` must be unset in this SAME statement,
    // before any replacement is set, or the promotion below would try to
    // insert a second non-null `defaultVariantKey` for this product while
    // the archived row's is still live and hit
    // `uq_at_most_one_default_variant_per_product` (docs/PHASE_4_CATALOG_PLAN.md
    // §4's unset-then-set ordering, applied here).
    const archived = await tx.productVariant.update({
      where: { id: variantId },
      data: { status: "ARCHIVED", isDefault: wasDefault ? false : undefined },
    });

    if (wasDefault) {
      const replacement = pickReplacementDefault(remainingActive);
      if (replacement) {
        await tx.productVariant.update({
          where: { id: replacement.id },
          data: { isDefault: true },
        });
      }
    }

    return archived;
  });
}

/** Moves a variant `ARCHIVED -> ACTIVE`. Idempotent on an already-`ACTIVE`
 * variant. No product-row lock — this can only ever add to the `ACTIVE`
 * set, never violate the invariant (§13a). Never sets `isDefault`. */
export async function reactivateVariant(
  variantId: bigint,
): Promise<ProductVariant> {
  return db.productVariant.update({
    where: { id: variantId },
    data: { status: "ACTIVE" },
  });
}

/** Every variant ID for the product, regardless of status — reordering
 * (docs/PHASE_4_CATALOG_PLAN.md §4) applies to the whole set, not just
 * `ACTIVE` ones. Not to be confused with `getActiveVariantsForUpdate`,
 * which deliberately filters to `ACTIVE` for invariant decisions. */
export async function findVariantIdsForProduct(
  productId: bigint,
): Promise<bigint[]> {
  const variants = await db.productVariant.findMany({
    where: { productId },
    select: { id: true },
  });
  return variants.map((v) => v.id);
}

export async function reorderVariants(
  productId: bigint,
  orderedVariantIds: bigint[],
): Promise<void> {
  await db.$transaction(
    orderedVariantIds.map((variantId, index) =>
      db.productVariant.update({
        where: { id: variantId, productId },
        data: { sortOrder: index },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Product images
// ---------------------------------------------------------------------------

export async function findImageById(imageId: bigint) {
  return db.productImage.findUnique({ where: { id: imageId } });
}

/** Pre-transaction lookup of *only* `productId` — the one field that's
 * immutable once an image is created, so reading it before the lock is
 * safe. Mirrors `findVariantProductId`'s exact reasoning and the same
 * fix: this runs on `db` (its own, immediately-committed connection),
 * NOT on a later `tx`, so it can never poison that transaction's
 * `REPEATABLE READ` snapshot the way the pre-fix `archiveVariant`/
 * `setDefaultVariant` lookups did (§6 of the implementation report). */
async function findImageProductId(imageId: bigint): Promise<bigint> {
  const image = await db.productImage.findUnique({
    where: { id: imageId },
    select: { productId: true },
  });
  if (!image) {
    throw new NotFoundError("Image not found.");
  }
  return image.productId;
}

export interface AddProductImageData {
  productId: bigint;
  url: string;
  altText?: string;
  width?: number;
  height?: number;
  isPrimary?: boolean;
  sortOrder?: number;
}

/**
 * Implements docs/PHASE_4_CATALOG_PLAN.md §7's primary-image invariant
 * transactionally, since `isPrimary` has no database uniqueness
 * constraint: the first image on a product is always primary; a
 * subsequent image defaults to non-primary unless explicitly requested,
 * in which case the existing primary is unset first.
 *
 * Locks the parent product row FIRST (§13a's mechanism, extended here per
 * the post-implementation-review correction): two concurrent
 * `addProductImage`/`setPrimaryImage`/`removeProductImage` calls on the
 * same product raced exactly like the variant-default invariant did
 * before that fix, and for the identical reason — `isPrimary` has no
 * unique-constraint backstop, so nothing but explicit serialization
 * prevents two images from both ending up primary. `data.productId` is
 * already known here (not derived from a prior read), so the lock is
 * unconditionally this function's first transactional statement, with no
 * risk of the pre-lock-snapshot bug found in `archiveVariant`/
 * `setDefaultVariant` (§6 of the implementation report).
 */
export async function addProductImage(data: AddProductImageData) {
  return db.$transaction(async (tx) => {
    await lockProductRow(tx, data.productId);

    const existingImageCount = await tx.productImage.count({
      where: { productId: data.productId },
    });
    const shouldBePrimary = existingImageCount === 0 || data.isPrimary === true;

    if (shouldBePrimary && existingImageCount > 0) {
      await tx.productImage.updateMany({
        where: { productId: data.productId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return tx.productImage.create({
      data: {
        productId: data.productId,
        url: data.url,
        altText: data.altText,
        width: data.width,
        height: data.height,
        isPrimary: shouldBePrimary,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  });
}

export interface UpdateProductImageData {
  altText?: string | null;
  width?: number | null;
  height?: number | null;
  sortOrder?: number;
}

export async function updateProductImage(
  imageId: bigint,
  data: UpdateProductImageData,
) {
  return db.productImage.update({ where: { id: imageId }, data });
}

/**
 * Unset-then-set, matching `setDefaultVariant`'s shape, applied to a
 * column without a database constraint backing it
 * (docs/PHASE_4_CATALOG_PLAN.md §7).
 *
 * Locks the parent product row FIRST, resolved outside the transaction
 * via `findImageProductId` — the post-implementation-review correction
 * closing the primary-image race that mirrored the variant-default one
 * before it was fixed (§6 of the implementation report). The image's
 * existence is re-checked AFTER the lock is held (not from the pre-lock
 * `findImageProductId` call), since a concurrent `removeProductImage`
 * could have deleted it while this call was waiting for the lock.
 */
export async function setPrimaryImage(imageId: bigint) {
  const productId = await findImageProductId(imageId);

  return db.$transaction(async (tx) => {
    await lockProductRow(tx, productId);

    const stillExists = await tx.productImage.findUnique({
      where: { id: imageId },
    });
    if (!stillExists) {
      throw new NotFoundError("Image not found.");
    }

    await tx.productImage.updateMany({
      where: { productId, isPrimary: true },
      data: { isPrimary: false },
    });
    return tx.productImage.update({
      where: { id: imageId },
      data: { isPrimary: true },
    });
  });
}

/**
 * Deletes the image; if it was primary, promotes the next by
 * `(sortOrder, id)` — a product with remaining images never ends up with
 * zero primary images as a side effect (docs/PHASE_4_CATALOG_PLAN.md §7).
 *
 * Locks the parent product row FIRST, same correction as `setPrimaryImage`
 * above — without it, this could race a concurrent `setPrimaryImage` on a
 * different image and leave two images marked primary (§6 of the
 * implementation report).
 */
export async function removeProductImage(imageId: bigint): Promise<void> {
  const productId = await findImageProductId(imageId);

  await db.$transaction(async (tx) => {
    await lockProductRow(tx, productId);

    const image = await tx.productImage.findUnique({ where: { id: imageId } });
    if (!image) {
      throw new NotFoundError("Image not found.");
    }

    await tx.productImage.delete({ where: { id: imageId } });

    if (image.isPrimary) {
      const nextImage = await tx.productImage.findFirst({
        where: { productId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
      if (nextImage) {
        await tx.productImage.update({
          where: { id: nextImage.id },
          data: { isPrimary: true },
        });
      }
    }
  });
}

export async function findImageIdsForProduct(
  productId: bigint,
): Promise<bigint[]> {
  const images = await db.productImage.findMany({
    where: { productId },
    select: { id: true },
  });
  return images.map((i) => i.id);
}

export async function reorderProductImages(
  productId: bigint,
  orderedImageIds: bigint[],
): Promise<void> {
  await db.$transaction(
    orderedImageIds.map((imageId, index) =>
      db.productImage.update({
        where: { id: imageId, productId },
        data: { sortOrder: index },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Product specifications
// ---------------------------------------------------------------------------

export interface UpsertProductSpecificationData {
  productId: bigint;
  specKey: string;
  specValue: string;
  unit?: string;
  groupLabel?: string;
  sortOrder?: number;
}

/** True upsert on `(productId, specKey)` — calling it again with the same
 * normalized key updates in place, never creates a duplicate
 * (docs/PHASE_4_CATALOG_PLAN.md §8). */
export async function upsertProductSpecification(
  data: UpsertProductSpecificationData,
) {
  return db.productSpecification.upsert({
    where: {
      productId_specKey: {
        productId: data.productId,
        specKey: data.specKey,
      },
    },
    create: {
      productId: data.productId,
      specKey: data.specKey,
      specValue: data.specValue,
      unit: data.unit,
      groupLabel: data.groupLabel,
      sortOrder: data.sortOrder ?? 0,
    },
    update: {
      specValue: data.specValue,
      unit: data.unit,
      groupLabel: data.groupLabel,
      sortOrder: data.sortOrder,
    },
  });
}

export async function removeProductSpecification(
  productId: bigint,
  specKey: string,
): Promise<void> {
  await db.productSpecification.deleteMany({ where: { productId, specKey } });
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export interface CreateBrandData {
  name: string;
  slug?: string;
  logoUrl?: string;
  description?: string;
}

export async function createBrand(data: CreateBrandData) {
  return resolveSlugAndWrite({
    explicitSlug: data.slug,
    nameForSlug: data.name,
    attemptWrite: (slug) =>
      db.brand.create({
        data: {
          name: data.name,
          slug,
          logoUrl: data.logoUrl,
          description: data.description,
        },
      }),
  });
}

export interface UpdateBrandData {
  name?: string;
  slug?: string;
  logoUrl?: string | null;
  description?: string | null;
}

export async function updateBrand(brandId: bigint, data: UpdateBrandData) {
  return resolveSlugAndWrite({
    explicitSlug: data.slug,
    nameForSlug: data.name ?? "",
    attemptWrite: (slug) =>
      db.brand.update({
        where: { id: brandId },
        data: {
          name: data.name,
          slug:
            data.slug !== undefined || data.name !== undefined
              ? slug
              : undefined,
          logoUrl: data.logoUrl,
          description: data.description,
        },
      }),
  });
}

export async function setBrandActive(brandId: bigint, isActive: boolean) {
  return db.brand.update({ where: { id: brandId }, data: { isActive } });
}

export async function findBrandById(brandId: bigint) {
  return db.brand.findUnique({ where: { id: brandId } });
}

/** Public brand-landing lookup (docs/PHASE_9_STOREFRONT_PLAN.md §31) —
 * mirrors `findProductBySlugPublic`'s public-visibility shape:
 * `isActive: true` only, never a numeric-id-only lookup. */
export async function findBrandBySlugPublic(slug: string) {
  return db.brand.findFirst({ where: { slug, isActive: true } });
}

export async function listBrands(publicOnly: boolean) {
  return db.brand.findMany({
    where: publicOnly ? { isActive: true } : undefined,
    orderBy: { name: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CreateCategoryData {
  name: string;
  slug?: string;
  description?: string;
  imageUrl?: string;
  parentId?: bigint | null;
  sortOrder?: number;
  isActive: boolean;
  seoTitle?: string;
  seoDescription?: string;
}

export async function createCategory(data: CreateCategoryData) {
  return resolveSlugAndWrite({
    explicitSlug: data.slug,
    nameForSlug: data.name,
    attemptWrite: (slug) =>
      db.category.create({
        data: {
          name: data.name,
          slug,
          description: data.description,
          imageUrl: data.imageUrl,
          parentId: data.parentId ?? null,
          sortOrder: data.sortOrder ?? 0,
          isActive: data.isActive,
          seoTitle: data.seoTitle,
          seoDescription: data.seoDescription,
        },
      }),
  });
}

export interface UpdateCategoryData {
  name?: string;
  slug?: string;
  description?: string | null;
  imageUrl?: string | null;
  parentId?: bigint | null;
  sortOrder?: number;
  isActive?: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export async function updateCategory(
  categoryId: bigint,
  data: UpdateCategoryData,
) {
  return resolveSlugAndWrite({
    explicitSlug: data.slug,
    nameForSlug: data.name ?? "",
    attemptWrite: (slug) =>
      db.category.update({
        where: { id: categoryId },
        data: {
          name: data.name,
          slug:
            data.slug !== undefined || data.name !== undefined
              ? slug
              : undefined,
          description: data.description,
          imageUrl: data.imageUrl,
          parentId: data.parentId,
          sortOrder: data.sortOrder,
          isActive: data.isActive,
          seoTitle: data.seoTitle,
          seoDescription: data.seoDescription,
        },
      }),
  });
}

export async function setCategoryActive(categoryId: bigint, isActive: boolean) {
  return db.category.update({ where: { id: categoryId }, data: { isActive } });
}

export async function findCategoryById(categoryId: bigint) {
  return db.category.findUnique({ where: { id: categoryId } });
}

/** Public category-landing lookup (docs/PHASE_9_STOREFRONT_PLAN.md §31) —
 * mirrors `findProductBySlugPublic`'s public-visibility shape:
 * `isActive: true` only. */
export async function findCategoryBySlugPublic(slug: string) {
  return db.category.findFirst({ where: { slug, isActive: true } });
}

/** Walks up from `startParentId` via `parentId`, bounded to
 * `MAX_CATEGORY_ANCESTOR_WALK_DEPTH` (docs/PHASE_4_CATALOG_PLAN.md §5),
 * returning true if `categoryId` appears anywhere in that ancestor chain
 * (including the trivial `startParentId === categoryId` case). Used to
 * reject a reparent that would create a cycle. */
export async function wouldCreateCategoryCycle(
  categoryId: bigint,
  startParentId: bigint,
  maxDepth: number,
): Promise<boolean> {
  let currentId: bigint | null = startParentId;
  for (let depth = 0; depth < maxDepth && currentId !== null; depth++) {
    if (currentId === categoryId) return true;
    const current: { parentId: bigint | null } | null =
      await db.category.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });
    if (!current) return false;
    currentId = current.parentId;
  }
  return false;
}

export async function findCategoryIdsForSiblingSet(
  parentId: bigint | null,
): Promise<bigint[]> {
  const categories = await db.category.findMany({
    where: { parentId },
    select: { id: true },
  });
  return categories.map((c) => c.id);
}

export async function reorderCategories(
  parentId: bigint | null,
  orderedCategoryIds: bigint[],
): Promise<void> {
  await db.$transaction(
    orderedCategoryIds.map((categoryId, index) =>
      db.category.update({
        where: { id: categoryId, parentId },
        data: { sortOrder: index },
      }),
    ),
  );
}

export async function listAllCategories(publicOnly: boolean) {
  return db.category.findMany({
    where: publicOnly ? { isActive: true } : undefined,
    orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }],
  });
}

// ---------------------------------------------------------------------------
// Admin dashboard metrics (docs/PHASE_10_ADMIN_PLAN.md §9) — read-only.
// ---------------------------------------------------------------------------

/** Matches the exact public-visibility definition `findProductBySlugPublic`/
 * `listProductsPublic` already use — `status: "ACTIVE", deletedAt: null` —
 * so this count means the same thing a customer's own product listing
 * would show, not a broader "every product row" count. */
export async function countActiveProducts(): Promise<number> {
  return db.product.count({ where: { status: "ACTIVE", deletedAt: null } });
}
