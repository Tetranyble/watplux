import type {
  Brand,
  Category,
  Product,
  ProductImage,
  ProductSpecification,
  ProductVariant,
} from "@prisma/client";

/**
 * Safe, client-returnable projections — the only shapes any catalog
 * use-case is allowed to hand back to a caller (same convention as
 * `src/modules/auth/types.ts`'s `SafeUser`). BigInt ids are always
 * stringified; Prisma `Decimal` fields are always converted to plain
 * `number` before crossing this boundary.
 */

export interface CatalogBrandSummary {
  id: string;
  name: string;
  slug: string;
}

export interface CatalogCategorySummary {
  id: string;
  name: string;
  slug: string;
}

export interface CatalogImage {
  id: string;
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface CatalogSpecification {
  specKey: string;
  specValue: string;
  unit: string | null;
  groupLabel: string | null;
  sortOrder: number;
}

export interface CatalogVariant {
  id: string;
  sku: string;
  variantLabel: string | null;
  optionValues: Record<string, string> | null;
  isDefault: boolean;
  status: "ACTIVE" | "ARCHIVED";
  sortOrder: number;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  currency: string;
  powerRatingW: number | null;
  voltageV: number | null;
  capacityWh: number | null;
  ratedCurrentA: number | null;
  phase: "SINGLE" | "THREE" | null;
  efficiencyPercent: number | null;
  mpptMinV: number | null;
  mpptMaxV: number | null;
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

/** Listing-card shape — deliberately narrower than `ProductDetail`
 * (docs/PHASE_4_CATALOG_PLAN.md §16: list use-cases select only what a
 * card needs). */
export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isFeatured: boolean;
  brand: CatalogBrandSummary | null;
  category: CatalogCategorySummary;
  primaryImage: Pick<CatalogImage, "url" | "altText"> | null;
  defaultVariant: Pick<
    CatalogVariant,
    "id" | "sku" | "priceMinor" | "compareAtPriceMinor" | "currency"
  > | null;
  createdAt: string;
}

/** PDP / admin-detail shape — the full graph. */
export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  unitOfMeasure: "EACH" | "METER";
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isFeatured: boolean;
  warrantyMonths: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  deletedAt: string | null;
  brand: CatalogBrandSummary | null;
  category: CatalogCategorySummary;
  variants: CatalogVariant[];
  images: CatalogImage[];
  specifications: CatalogSpecification[];
  createdAt: string;
  updatedAt: string;
}

export interface CatalogBrand {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
  isActive: boolean;
}

export interface CatalogCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface CategoryTreeNode extends CatalogCategory {
  children: CategoryTreeNode[];
}

/** Keyset ("cursor") pagination envelope — never offset/limit
 * (docs/PHASE_4_CATALOG_PLAN.md §16). `nextCursor` is opaque to callers;
 * pass it back verbatim as the next request's `cursor` input. `null`
 * means there is no further page. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Mappers: Prisma row -> safe shape. Centralized here (not duplicated across
// use-cases) so every call site converts BigInt/Decimal the same way.
// ---------------------------------------------------------------------------

function decimalToNumber(value: { toNumber(): number } | null): number | null {
  return value === null ? null : value.toNumber();
}

export function toCatalogBrandSummary(brand: {
  id: bigint;
  name: string;
  slug: string;
}): CatalogBrandSummary {
  return { id: brand.id.toString(), name: brand.name, slug: brand.slug };
}

export function toCatalogCategorySummary(category: {
  id: bigint;
  name: string;
  slug: string;
}): CatalogCategorySummary {
  return {
    id: category.id.toString(),
    name: category.name,
    slug: category.slug,
  };
}

export function toCatalogImage(image: ProductImage): CatalogImage {
  return {
    id: image.id.toString(),
    url: image.url,
    altText: image.altText,
    width: image.width,
    height: image.height,
    isPrimary: image.isPrimary,
    sortOrder: image.sortOrder,
  };
}

export function toCatalogSpecification(
  spec: ProductSpecification,
): CatalogSpecification {
  return {
    specKey: spec.specKey,
    specValue: spec.specValue,
    unit: spec.unit,
    groupLabel: spec.groupLabel,
    sortOrder: spec.sortOrder,
  };
}

export function toCatalogVariant(variant: ProductVariant): CatalogVariant {
  return {
    id: variant.id.toString(),
    sku: variant.sku,
    variantLabel: variant.variantLabel,
    optionValues: variant.optionValues as Record<string, string> | null,
    isDefault: variant.isDefault,
    status: variant.status,
    sortOrder: variant.sortOrder,
    priceMinor: variant.priceMinor,
    compareAtPriceMinor: variant.compareAtPriceMinor,
    currency: variant.currency,
    powerRatingW: variant.powerRatingW,
    voltageV: variant.voltageV,
    capacityWh: variant.capacityWh,
    ratedCurrentA: variant.ratedCurrentA,
    phase: variant.phase,
    efficiencyPercent: decimalToNumber(variant.efficiencyPercent),
    mpptMinV: variant.mpptMinV,
    mpptMaxV: variant.mpptMaxV,
    weightKg: decimalToNumber(variant.weightKg),
    lengthCm: decimalToNumber(variant.lengthCm),
    widthCm: decimalToNumber(variant.widthCm),
    heightCm: decimalToNumber(variant.heightCm),
  };
}

export function toCatalogBrand(brand: Brand): CatalogBrand {
  return {
    id: brand.id.toString(),
    name: brand.name,
    slug: brand.slug,
    logoUrl: brand.logoUrl,
    description: brand.description,
    isActive: brand.isActive,
  };
}

export function toCatalogCategory(category: Category): CatalogCategory {
  return {
    id: category.id.toString(),
    parentId: category.parentId?.toString() ?? null,
    name: category.name,
    slug: category.slug,
    description: category.description,
    imageUrl: category.imageUrl,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    seoTitle: category.seoTitle,
    seoDescription: category.seoDescription,
  };
}

/** The exact shape `repo.ts`'s `listProductsPublic`/`listProductsForAdmin`
 * select — a listing-card row, not a full `Product`. */
export interface ProductSummaryRow {
  id: bigint;
  name: string;
  slug: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isFeatured: boolean;
  createdAt: Date;
  brand: { id: bigint; name: string; slug: string } | null;
  category: { id: bigint; name: string; slug: string };
  images: { url: string; altText: string | null }[];
  variants: {
    id: bigint;
    sku: string;
    priceMinor: number;
    compareAtPriceMinor: number | null;
    currency: string;
  }[];
}

export function toProductSummary(row: ProductSummaryRow): ProductSummary {
  const primaryImage = row.images[0];
  const defaultVariant = row.variants[0];
  return {
    id: row.id.toString(),
    name: row.name,
    slug: row.slug,
    status: row.status,
    isFeatured: row.isFeatured,
    brand: row.brand ? toCatalogBrandSummary(row.brand) : null,
    category: toCatalogCategorySummary(row.category),
    primaryImage: primaryImage
      ? { url: primaryImage.url, altText: primaryImage.altText }
      : null,
    defaultVariant: defaultVariant
      ? {
          id: defaultVariant.id.toString(),
          sku: defaultVariant.sku,
          priceMinor: defaultVariant.priceMinor,
          compareAtPriceMinor: defaultVariant.compareAtPriceMinor,
          currency: defaultVariant.currency,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toProductDetail(
  product: Product & {
    brand: Brand | null;
    category: Category;
    variants: ProductVariant[];
    images: ProductImage[];
    specifications: ProductSpecification[];
  },
): ProductDetail {
  return {
    id: product.id.toString(),
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription,
    description: product.description,
    unitOfMeasure: product.unitOfMeasure,
    status: product.status,
    isFeatured: product.isFeatured,
    warrantyMonths: product.warrantyMonths,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    deletedAt: product.deletedAt?.toISOString() ?? null,
    brand: product.brand ? toCatalogBrandSummary(product.brand) : null,
    category: toCatalogCategorySummary(product.category),
    variants: product.variants.map(toCatalogVariant),
    images: product.images.map(toCatalogImage),
    specifications: product.specifications.map(toCatalogSpecification),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
