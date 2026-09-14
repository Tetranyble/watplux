import Link from "next/link";
import type { Metadata } from "next";

import { InventoryFilterForm } from "@/components/admin/inventory-filter-form";
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
import { formatQuantity } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import { listInventory } from "@/src/modules/inventory/use-cases/list-inventory";

export const metadata: Metadata = { title: "Inventory" };

// Reads `searchParams` (the `lowStockOnly` filter/cursor) and the
// session — inherently per-request.
export const instant = false;

/**
 * `inventory.read`, enforced inside `listInventory` itself
 * (docs/PHASE_10_ADMIN_PLAN.md §11). Available/reserved/on-hand are
 * always rendered as three distinct, separately-labeled numbers — never
 * conflated into one "stock" figure. The low-stock badge is a plain
 * client-side comparison against data already fetched (`quantityAvailable
 * <= lowStockThreshold`), not a second query.
 *
 * `InventoryBalance` carries no product/variant name or SKU — Inventory
 * is deliberately decoupled from Catalog (docs/PHASE_5_INVENTORY_PLAN.md),
 * and no additive join was approved for this screen — so each row links
 * to its detail page by variant id, matching exactly what the plan's
 * §11 table describes.
 */
export default async function AdminInventoryPage({
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

  const lowStockOnly = get("lowStockOnly") === "true";
  const cursor = get("cursor");

  const page = await listInventory(actor, {
    limit: 20,
    lowStockOnly,
    cursor,
  });

  const nextPageParams = new URLSearchParams();
  if (lowStockOnly) nextPageParams.set("lowStockOnly", "true");
  if (page.nextCursor) nextPageParams.set("cursor", page.nextCursor);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Inventory</h1>

      <InventoryFilterForm lowStockOnly={lowStockOnly} />

      {page.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No inventory items match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((item) => {
                const isLowStock =
                  item.lowStockThreshold !== null &&
                  item.quantityAvailable !== null &&
                  item.quantityAvailable <= item.lowStockThreshold;
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        href={`/admin/inventory/${item.productVariantId}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        Variant #{item.productVariantId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.quantityAvailable !== null
                        ? formatQuantity(item.quantityAvailable)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatQuantity(item.quantityReserved)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatQuantity(item.quantityOnHand)}
                    </TableCell>
                    <TableCell>
                      {isLowStock ? (
                        <Badge variant="destructive">Low stock</Badge>
                      ) : (
                        <Badge variant="secondary">OK</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
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
              <Link href={`/admin/inventory?${nextPageParams.toString()}`} />
            }
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
