import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { InventoryMutationForms } from "@/components/admin/inventory-mutation-forms";
import { Button } from "@/components/ui/button";
import { formatDate, formatQuantity } from "@/lib/format";
import { NotFoundError } from "@/lib/errors";
import { getSessionUser } from "@/lib/session";
import { PERMISSION_INVENTORY_ADJUST } from "@/src/modules/inventory/constants";
import { idParamSchema } from "@/src/modules/inventory/schema";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";
import { getInventoryMovementHistory } from "@/src/modules/inventory/use-cases/get-inventory-movement-history";
import type { InventoryBalance } from "@/src/modules/inventory/types";

export const metadata: Metadata = { title: "Inventory detail" };

export const instant = false;

/**
 * `inventory.read`, enforced inside `getInventoryForVariant` itself
 * (docs/PHASE_10_ADMIN_PLAN.md §11). A `NotFoundError` here means
 * "nothing tracked for this variant yet" — a real, legitimate state
 * (`restockInventory` creates the row on first use), not a broken URL —
 * so it's handled inline as an empty-balance state offering only the
 * Restock form, never routed through `notFound()`. Only a genuinely
 * malformed `variantId` param 404s.
 */
export default async function AdminInventoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ variantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getSessionUser();
  if (!actor) return null;

  const { variantId } = await params;
  const parsedVariantId = idParamSchema.safeParse(variantId);
  if (!parsedVariantId.success) {
    notFound();
  }

  let balance: InventoryBalance | null = null;
  try {
    balance = await getInventoryForVariant(actor, parsedVariantId.data);
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error;
    }
  }

  const rawParams = await searchParams;
  const cursorParam = rawParams.cursor;
  const cursor = Array.isArray(cursorParam) ? cursorParam[0] : cursorParam;

  const history = balance
    ? await getInventoryMovementHistory(actor, BigInt(balance.id), {
        limit: 20,
        cursor,
      })
    : null;

  const canAdjust = actor.permissions.has(PERMISSION_INVENTORY_ADJUST);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">
        Inventory — Variant #{variantId}
      </h1>

      {balance ? (
        <section className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Available</p>
            <p className="text-xl font-semibold">
              {balance.quantityAvailable !== null
                ? formatQuantity(balance.quantityAvailable)
                : "—"}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Reserved</p>
            <p className="text-xl font-semibold">
              {formatQuantity(balance.quantityReserved)}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">On hand</p>
            <p className="text-xl font-semibold">
              {formatQuantity(balance.quantityOnHand)}
            </p>
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          No inventory is tracked for this variant yet — recording a restock
          below will start tracking it.
        </p>
      )}

      {canAdjust ? (
        <InventoryMutationForms
          variantId={variantId}
          hasExistingItem={balance !== null}
        />
      ) : null}

      {history ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Movement history
          </h2>
          {history.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No movements recorded yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.items.map((movement) => (
                <li
                  key={movement.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{movement.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(movement.createdAt)}
                      {movement.note ? ` — ${movement.note}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p>
                      On-hand{" "}
                      {movement.onHandDelta >= 0
                        ? `+${formatQuantity(movement.onHandDelta)}`
                        : formatQuantity(movement.onHandDelta)}
                    </p>
                    {movement.reservedDelta !== 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Reserved{" "}
                        {movement.reservedDelta >= 0
                          ? `+${formatQuantity(movement.reservedDelta)}`
                          : formatQuantity(movement.reservedDelta)}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {history.nextCursor ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    href={`/admin/inventory/${variantId}?cursor=${encodeURIComponent(history.nextCursor)}`}
                  />
                }
              >
                Load more
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
