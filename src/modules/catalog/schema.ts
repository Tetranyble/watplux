import { z } from "zod";

import { isValidCompareAtPrice } from "@/src/modules/catalog/domain/money";
import { isValidSlugShape } from "@/src/modules/catalog/slug";
import {
  isValidSpecKeyShape,
  normalizeSpecKey,
} from "@/src/modules/catalog/domain/specification-key";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/src/modules/catalog/constants";

/**
 * Single source of truth for catalog input shapes
 * (docs/PHASE_4_CATALOG_PLAN.md §10) — every use-case's public input goes
 * through one of these before the use-case body runs, matching
 * `src/modules/auth/schema.ts`'s convention.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Parses a route-param-shaped ID (`z.coerce` handles the string-over-the-wire
 * case, matching Phase 3's `assignRoleSchema` convention). */
export const idParamSchema = z.coerce.bigint().positive();

/** An optional, explicit slug field — shape-validated but never
 * suffix-retried; a conflict on this exact value is a hard `ConflictError`
 * (docs/PHASE_4_CATALOG_PLAN.md §11). Omitted entirely means "auto-derive
 * from the name," a distinct code path handled in the repo layer, not here. */
const explicitSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(isValidSlugShape, {
    message:
      "Slug must be lowercase letters, numbers, and single hyphens only.",
  })
  .optional();

const seoTitleSchema = z.string().trim().min(1).max(255).optional();
const seoDescriptionSchema = z.string().trim().min(1).max(500).optional();

const urlLikeSchema = z.string().trim().min(1).max(500);
const altTextSchema = z.string().trim().min(1).max(255).optional();

const priceMinorSchema = z.number().int().nonnegative();
const compareAtPriceMinorSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .optional();

const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9._-]+$/,
    "SKU may only contain letters, numbers, dots, hyphens, and underscores.",
  );

const dimensionSchema = z.number().positive().optional();

const solarFacetsSchema = z.object({
  powerRatingW: z.number().int().nonnegative().optional(),
  voltageV: z.number().int().nonnegative().optional(),
  capacityWh: z.number().int().nonnegative().optional(),
  ratedCurrentA: z.number().int().nonnegative().optional(),
  phase: z.enum(["SINGLE", "THREE"]).optional(),
  efficiencyPercent: z.number().min(0).max(100).optional(),
  mpptMinV: z.number().int().nonnegative().optional(),
  mpptMaxV: z.number().int().nonnegative().optional(),
});

const logisticsFacetsSchema = z.object({
  weightKg: dimensionSchema,
  lengthCm: dimensionSchema,
  widthCm: dimensionSchema,
  heightCm: dimensionSchema,
});

function withMpptRangeCheck<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const facets = value as { mpptMinV?: number; mpptMaxV?: number };
    if (
      facets.mpptMinV !== undefined &&
      facets.mpptMaxV !== undefined &&
      facets.mpptMinV > facets.mpptMaxV
    ) {
      ctx.addIssue({
        code: "custom",
        message: "mpptMinV must be less than or equal to mpptMaxV.",
        path: ["mpptMinV"],
      });
    }
  });
}

function withCompareAtPriceCheck<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const priced = value as {
      priceMinor?: number;
      compareAtPriceMinor?: number | null;
    };
    if (
      priced.priceMinor !== undefined &&
      !isValidCompareAtPrice(priced.priceMinor, priced.compareAtPriceMinor)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "compareAtPriceMinor must be greater than or equal to priceMinor.",
        path: ["compareAtPriceMinor"],
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const cursorPaginationSchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const firstVariantInputSchema = withMpptRangeCheck(
  withCompareAtPriceCheck(
    z.object({
      sku: skuSchema,
      variantLabel: z.string().trim().min(1).max(255).optional(),
      optionValues: z.record(z.string(), z.string()).optional(),
      priceMinor: priceMinorSchema,
      compareAtPriceMinor: compareAtPriceMinorSchema,
      sortOrder: z.number().int().nonnegative().optional(),
      ...solarFacetsSchema.shape,
      ...logisticsFacetsSchema.shape,
    }),
  ),
);

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: explicitSlugSchema,
  shortDescription: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().min(1).optional(),
  unitOfMeasure: z.enum(["EACH", "METER"]).default("EACH"),
  categoryId: idParamSchema,
  brandId: idParamSchema.nullable().optional(),
  warrantyMonths: z.number().int().nonnegative().optional(),
  isFeatured: z.boolean().default(false),
  seoTitle: seoTitleSchema,
  seoDescription: seoDescriptionSchema,
  variant: firstVariantInputSchema,
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  slug: explicitSlugSchema,
  shortDescription: z.string().trim().min(1).max(500).nullable().optional(),
  description: z.string().trim().min(1).nullable().optional(),
  unitOfMeasure: z.enum(["EACH", "METER"]).optional(),
  categoryId: idParamSchema.optional(),
  brandId: idParamSchema.nullable().optional(),
  warrantyMonths: z.number().int().nonnegative().nullable().optional(),
  isFeatured: z.boolean().optional(),
  seoTitle: seoTitleSchema.or(z.null()),
  seoDescription: seoDescriptionSchema.or(z.null()),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// Base object schema (no `.superRefine` yet) so both the public and admin
// listing schemas can still `.extend()` it — a `ZodEffects` (the result of
// `.superRefine`) can no longer be `.extend()`-ed, so the cross-field price
// range check below is applied via `withPriceRangeCheck` AFTER each schema
// has taken its final object shape (mirrors `withMpptRangeCheck`'s existing
// pattern in this file), not baked into the shared base itself.
const listProductsBaseSchema = cursorPaginationSchema.extend({
  categoryId: idParamSchema.optional(),
  brandId: idParamSchema.optional(),
  featured: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().min(1).max(255).optional(),
  // --- Phase 9 additive filter extensions (docs/PHASE_9_STOREFRONT_PLAN.md §9) ---
  minPriceMinor: z.coerce.number().int().nonnegative().optional(),
  maxPriceMinor: z.coerce.number().int().nonnegative().optional(),
  powerRatingWMin: z.coerce.number().int().nonnegative().optional(),
  powerRatingWMax: z.coerce.number().int().nonnegative().optional(),
  voltageV: z.coerce.number().int().nonnegative().optional(),
  phase: z.enum(["SINGLE", "THREE"]).optional(),
  inStockOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  sortBy: z.enum(["newest", "featured", "price_asc", "price_desc"]).optional(),
});

function withPriceRangeCheck<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const v = value as {
      minPriceMinor?: number;
      maxPriceMinor?: number;
      powerRatingWMin?: number;
      powerRatingWMax?: number;
    };
    if (
      v.minPriceMinor !== undefined &&
      v.maxPriceMinor !== undefined &&
      v.minPriceMinor > v.maxPriceMinor
    ) {
      ctx.addIssue({
        code: "custom",
        message: "minPriceMinor must be less than or equal to maxPriceMinor.",
        path: ["minPriceMinor"],
      });
    }
    if (
      v.powerRatingWMin !== undefined &&
      v.powerRatingWMax !== undefined &&
      v.powerRatingWMin > v.powerRatingWMax
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "powerRatingWMin must be less than or equal to powerRatingWMax.",
        path: ["powerRatingWMin"],
      });
    }
  });
}

export const listProductsSchema = withPriceRangeCheck(listProductsBaseSchema);
export type ListProductsInput = z.infer<typeof listProductsSchema>;

export const listProductsForAdminSchema = withPriceRangeCheck(
  listProductsBaseSchema.extend({
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
    includeDeleted: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  }),
);
export type ListProductsForAdminInput = z.infer<
  typeof listProductsForAdminSchema
>;

export const getCategoryBySlugSchema = z.object({
  slug: z.string().trim().min(1),
});
export type GetCategoryBySlugInput = z.infer<typeof getCategoryBySlugSchema>;

export const getBrandBySlugSchema = z.object({
  slug: z.string().trim().min(1),
});
export type GetBrandBySlugInput = z.infer<typeof getBrandBySlugSchema>;

export const getProductBySlugSchema = z.object({
  slug: z.string().trim().min(1),
});
export type GetProductBySlugInput = z.infer<typeof getProductBySlugSchema>;

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export const createVariantSchema = withMpptRangeCheck(
  withCompareAtPriceCheck(
    z.object({
      productId: idParamSchema,
      sku: skuSchema,
      variantLabel: z.string().trim().min(1).max(255).optional(),
      optionValues: z.record(z.string(), z.string()).optional(),
      priceMinor: priceMinorSchema,
      compareAtPriceMinor: compareAtPriceMinorSchema,
      sortOrder: z.number().int().nonnegative().optional(),
      ...solarFacetsSchema.shape,
      ...logisticsFacetsSchema.shape,
    }),
  ),
);
export type CreateVariantInput = z.infer<typeof createVariantSchema>;

export const updateVariantSchema = withMpptRangeCheck(
  z.object({
    sku: skuSchema.optional(),
    variantLabel: z.string().trim().min(1).max(255).nullable().optional(),
    optionValues: z.record(z.string(), z.string()).nullable().optional(),
    priceMinor: priceMinorSchema.optional(),
    compareAtPriceMinor: compareAtPriceMinorSchema,
    sortOrder: z.number().int().nonnegative().optional(),
    powerRatingW: solarFacetsSchema.shape.powerRatingW.nullable(),
    voltageV: solarFacetsSchema.shape.voltageV.nullable(),
    capacityWh: solarFacetsSchema.shape.capacityWh.nullable(),
    ratedCurrentA: solarFacetsSchema.shape.ratedCurrentA.nullable(),
    phase: solarFacetsSchema.shape.phase.nullable(),
    efficiencyPercent: solarFacetsSchema.shape.efficiencyPercent.nullable(),
    mpptMinV: solarFacetsSchema.shape.mpptMinV.nullable(),
    mpptMaxV: solarFacetsSchema.shape.mpptMaxV.nullable(),
    weightKg: dimensionSchema.nullable(),
    lengthCm: dimensionSchema.nullable(),
    widthCm: dimensionSchema.nullable(),
    heightCm: dimensionSchema.nullable(),
  }),
).superRefine((value, ctx) => {
  if (
    value.priceMinor !== undefined &&
    !isValidCompareAtPrice(value.priceMinor, value.compareAtPriceMinor)
  ) {
    ctx.addIssue({
      code: "custom",
      message:
        "compareAtPriceMinor must be greater than or equal to priceMinor.",
      path: ["compareAtPriceMinor"],
    });
  }
});
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

export const reorderVariantsSchema = z.object({
  productId: idParamSchema,
  variantIds: z.array(idParamSchema).min(1),
});
export type ReorderVariantsInput = z.infer<typeof reorderVariantsSchema>;

// ---------------------------------------------------------------------------
// Product images
// ---------------------------------------------------------------------------

export const addProductImageSchema = z.object({
  productId: idParamSchema,
  url: urlLikeSchema,
  altText: altTextSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  isPrimary: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type AddProductImageInput = z.infer<typeof addProductImageSchema>;

export const updateProductImageSchema = z.object({
  altText: altTextSchema.or(z.null()),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type UpdateProductImageInput = z.infer<typeof updateProductImageSchema>;

export const reorderProductImagesSchema = z.object({
  productId: idParamSchema,
  imageIds: z.array(idParamSchema).min(1),
});
export type ReorderProductImagesInput = z.infer<
  typeof reorderProductImagesSchema
>;

// ---------------------------------------------------------------------------
// Product specifications
// ---------------------------------------------------------------------------

export const upsertProductSpecificationSchema = z.object({
  productId: idParamSchema,
  specKey: z
    .string()
    .trim()
    .min(1)
    .transform((value) => normalizeSpecKey(value))
    .refine(isValidSpecKeyShape, {
      message:
        "Specification key must be lowercase letters, numbers, and underscores only.",
    }),
  specValue: z.string().trim().min(1).max(500),
  unit: z.string().trim().min(1).max(20).optional(),
  groupLabel: z.string().trim().min(1).max(100).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type UpsertProductSpecificationInput = z.infer<
  typeof upsertProductSpecificationSchema
>;

export const removeProductSpecificationSchema = z.object({
  productId: idParamSchema,
  specKey: z
    .string()
    .trim()
    .min(1)
    .transform((value) => normalizeSpecKey(value)),
});
export type RemoveProductSpecificationInput = z.infer<
  typeof removeProductSpecificationSchema
>;

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export const createBrandSchema = z.object({
  name: z.string().trim().min(1).max(150),
  slug: explicitSlugSchema,
  logoUrl: urlLikeSchema.optional(),
  description: z.string().trim().min(1).optional(),
});
export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export const updateBrandSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  slug: explicitSlugSchema,
  logoUrl: urlLikeSchema.nullable().optional(),
  description: z.string().trim().min(1).nullable().optional(),
});
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(150),
  slug: explicitSlugSchema,
  description: z.string().trim().min(1).optional(),
  imageUrl: urlLikeSchema.optional(),
  parentId: idParamSchema.nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().default(true),
  seoTitle: seoTitleSchema,
  seoDescription: seoDescriptionSchema,
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  slug: explicitSlugSchema,
  description: z.string().trim().min(1).nullable().optional(),
  imageUrl: urlLikeSchema.nullable().optional(),
  parentId: idParamSchema.nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  seoTitle: seoTitleSchema.or(z.null()),
  seoDescription: seoDescriptionSchema.or(z.null()),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const reorderCategoriesSchema = z.object({
  parentId: idParamSchema.nullable(),
  categoryIds: z.array(idParamSchema).min(1),
});
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
