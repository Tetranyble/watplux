"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "@/components/ui/toast";
import { z } from "zod";

import { ControlledInput } from "@/components/forms/controlled-fields";
import { UrlDialog, useUrlDialog } from "@/components/router/url-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { upsertProductSpecificationSchema } from "@/src/modules/catalog/schema";
import type { CatalogSpecification } from "@/src/modules/catalog/types";

type SpecForm = z.input<typeof upsertProductSpecificationSchema>;

async function mutate(
  url: string,
  method: string,
  body?: Record<string, unknown>,
) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    issues?: string[];
  } | null;
  return { ok: response.ok, message: payload?.issues?.[0] ?? payload?.error };
}

function SpecificationForm({
  productId,
  close,
  initial,
}: {
  productId: string;
  close: () => void;
  initial?: CatalogSpecification;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<SpecForm>({
    resolver: zodResolver(upsertProductSpecificationSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: initial
      ? {
          productId,
          specKey: initial.specKey,
          specValue: initial.specValue,
          unit: initial.unit ?? undefined,
          groupLabel: initial.groupLabel ?? undefined,
          sortOrder: initial.sortOrder,
        }
      : {
          productId,
          specKey: "",
          specValue: "",
          unit: undefined,
          groupLabel: undefined,
          sortOrder: 0,
        },
  });

  const submit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await mutate(
        `/api/admin/catalog/products/${productId}/specifications`,
        "POST",
        values as Record<string, unknown>,
      );
      if (!result.ok) {
        toast.error(result.message ?? "Could not save specification.");
        return;
      }
      toast.success("Specification saved.");
      close();
      router.refresh();
    });
  });

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ControlledInput
          control={control}
          name="specKey"
          label="Key"
          placeholder="cell_type"
          required
          description="Spaces and capitals are normalized to a stable specification key."
        />
        <ControlledInput
          control={control}
          name="specValue"
          label="Value"
          required
        />
        <ControlledInput
          control={control}
          name="unit"
          label="Unit"
          placeholder="V, W, kg…"
          emptyAsUndefined
        />
        <ControlledInput
          control={control}
          name="groupLabel"
          label="Group"
          placeholder="Electrical"
          emptyAsUndefined
        />
        <ControlledInput
          control={control}
          name="sortOrder"
          label="Sort order"
          type="number"
          min={0}
          valueAsNumber
          emptyAsUndefined
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={close}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !isValid}>
          {pending
            ? "Saving…"
            : initial
              ? "Save changes"
              : "Save specification"}
        </Button>
      </div>
    </form>
  );
}

export function SpecificationManager({
  productId,
  specifications,
  canUpdate,
}: {
  productId: string;
  specifications: CatalogSpecification[];
  canUpdate: boolean;
}) {
  const router = useRouter();
  const createDialog = useUrlDialog("specification-create");
  const editDialog = useUrlDialog("specification-edit");
  const selected = specifications.find(
    (item) => item.specKey === editDialog.searchParams.get("item"),
  );
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!removeKey) return;
    startTransition(async () => {
      const result = await mutate(
        `/api/admin/catalog/products/${productId}/specifications/${encodeURIComponent(removeKey)}`,
        "DELETE",
      );
      if (!result.ok) {
        toast.error(result.message ?? "Could not remove specification.");
        return;
      }
      toast.success("Specification removed.");
      setRemoveKey(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {canUpdate ? (
        <div className="flex justify-end">
          <Button type="button" onClick={() => createDialog.open()}>
            <Plus className="size-4" />
            Add specification
          </Button>
        </div>
      ) : null}
      {specifications.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {specifications.map((spec) => (
            <Card key={spec.specKey} size="sm">
              <CardContent className="flex items-start justify-between gap-4 pt-0">
                <div className="min-w-0">
                  <p className="font-medium">{spec.specKey}</p>
                  <p className="mt-1 text-sm">
                    {spec.specValue}
                    {spec.unit ? ` ${spec.unit}` : ""}
                  </p>
                  {spec.groupLabel ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {spec.groupLabel}
                    </p>
                  ) : null}
                </div>
                {canUpdate ? (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${spec.specKey}`}
                      onClick={() => editDialog.open({ item: spec.specKey })}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${spec.specKey}`}
                      onClick={() => setRemoveKey(spec.specKey)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No specifications yet.
        </div>
      )}

      <UrlDialog
        dialogKey="specification-create"
        title="Add specification"
        description="Create or upsert a structured product specification."
      >
        {(close) => <SpecificationForm productId={productId} close={close} />}
      </UrlDialog>
      <UrlDialog
        dialogKey="specification-edit"
        title="Edit specification"
        description="Update the value and presentation metadata for this specification."
      >
        {(close) =>
          selected ? (
            <SpecificationForm
              productId={productId}
              close={close}
              initial={selected}
            />
          ) : null
        }
      </UrlDialog>
      <ConfirmDialog
        open={Boolean(removeKey)}
        onOpenChange={(open) => !open && setRemoveKey(null)}
        title="Remove specification?"
        description="This removes the specification from this product."
        confirmLabel="Remove"
        destructive
        busy={pending}
        onConfirm={remove}
      />
    </div>
  );
}
