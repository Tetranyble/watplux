import Link from "next/link";
import type { Metadata } from "next";
import { PackageOpen, Plus, SearchX } from "lucide-react";

import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { CatalogSubNav } from "@/components/admin/catalog-sub-nav";
import { ProductFilterForm } from "@/components/admin/product-filter-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMinorUnits } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import type { ListProductsForAdminInput } from "@/src/modules/catalog/schema";
import type { ProductSummary } from "@/src/modules/catalog/types";
import { listProductsForAdmin } from "@/src/modules/catalog/use-cases/list-products-for-admin";
import { PERMISSION_PRODUCTS_CREATE } from "@/src/modules/catalog/constants";

export const metadata: Metadata = { title: "Products" };

export const instant = false;

const PRODUCT_STATUSES = new Set<ProductSummary["status"]>([
  "DRAFT",
  "ACTIVE",
  "ARCHIVED",
]);

function parseProductStatus(
  value: string | undefined,
): ProductSummary["status"] | undefined {
  return value && PRODUCT_STATUSES.has(value as ProductSummary["status"])
    ? (value as ProductSummary["status"])
    : undefined;
}

const STATUS_VARIANT: Record<
  ProductSummary["status"],
  "default" | "secondary" | "outline"
> = {
  DRAFT: "outline",
  ACTIVE: "default",
  ARCHIVED: "secondary",
};

/**
 * `products.read`, enforced inside `listProductsForAdmin` itself
 * (docs/PHASE_10_ADMIN_PLAN.md §10). Every status is visible here
 * (unlike the public storefront listing), including `DRAFT`/`ARCHIVED`
 * and, when explicitly requested, soft-deleted rows.
 */
export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getSessionUser();
  if (!actor) return null;

  const rawParams = await searchParams;
  const get = (key: string): string | undefined => {
    const value = rawParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const includeDeleted = get("includeDeleted") === "true";
  const filters: ListProductsForAdminInput = {
    limit: 20,
    status: parseProductStatus(get("status")),
    search: get("search")?.trim() || undefined,
    includeDeleted,
    featured: undefined,
    cursor: get("cursor"),
  };

  const page = await listProductsForAdmin(actor, filters);
  const canCreate = actor.permissions.has(PERMISSION_PRODUCTS_CREATE);

  const nextPageParams = new URLSearchParams();
  if (get("status")) nextPageParams.set("status", get("status")!);
  if (get("search")) nextPageParams.set("search", get("search")!);
  if (includeDeleted) nextPageParams.set("includeDeleted", "true");
  if (page.nextCursor) nextPageParams.set("cursor", page.nextCursor);
  const hasFilters = Boolean(
    get("status") || get("search")?.trim() || includeDeleted,
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <CatalogSubNav active="/admin/catalog/products" />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search, filter and create catalog products from one consistent
            workspace.
          </p>
        </div>
        {canCreate ? (
          <Button
            nativeButton={false}
            render={<Link href="/admin/catalog/products/new" />}
            className="w-full sm:w-auto"
          >
            <Plus className="size-4" />
            New product
          </Button>
        ) : null}
      </div>

      <ProductFilterForm
        values={{
          status: get("status"),
          search: get("search"),
          includeDeleted,
        }}
      />

      {page.items.length === 0 ? (
        <AdminEmptyState
          icon={hasFilters ? SearchX : PackageOpen}
          title={hasFilters ? "No matching products" : "No products yet"}
          description={
            hasFilters
              ? "Adjust or clear the filters to see more of the catalog."
              : "Create the first product to start building the catalog."
          }
          action={
            hasFilters || canCreate ? (
              <Button
                variant={hasFilters ? "outline" : "default"}
                nativeButton={false}
                render={
                  <Link
                    href={
                      hasFilters
                        ? "/admin/catalog/products"
                        : "/admin/catalog/products/new"
                    }
                  />
                }
              >
                {hasFilters ? "Clear filters" : "New product"}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <Link
                      href={`/admin/catalog/products/${product.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {product.name}
                    </Link>
                    {product.isFeatured ? (
                      <Badge variant="secondary" className="ml-2">
                        Featured
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{product.category.name}</TableCell>
                  <TableCell>{product.brand?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[product.status]}>
                      {product.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {product.defaultVariant
                      ? formatMinorUnits(
                          product.defaultVariant.priceMinor,
                          product.defaultVariant.currency,
                        )
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {page.nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link
                href={`/admin/catalog/products?${nextPageParams.toString()}`}
              />
            }
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
