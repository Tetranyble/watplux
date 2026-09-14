"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm, type Control } from "react-hook-form";
import { toast } from "@/components/ui/toast";
import { z } from "zod";

import {
  ControlledInput,
  ControlledSelect,
} from "@/components/forms/controlled-fields";
import { UrlDialog, useUrlDialog } from "@/components/router/url-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMinorUnits } from "@/lib/format";
import {
  createVariantSchema,
  updateVariantSchema,
} from "@/src/modules/catalog/schema";
import type { CatalogVariant } from "@/src/modules/catalog/types";

type CreateValues = z.input<typeof createVariantSchema>;
type EditValues = z.input<typeof updateVariantSchema>;

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

function CreateVariantFields({ control }: { control: Control<CreateValues> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ControlledInput
        control={control}
        name="sku"
        label="SKU"
        required
        placeholder="INV-5KVA-001"
      />
      <ControlledInput
        control={control}
        name="variantLabel"
        label="Variant label"
        emptyAsUndefined
        placeholder="5 kVA / 48 V"
      />
      <ControlledInput
        control={control}
        name="priceMinor"
        label="Price (minor units)"
        type="number"
        min={0}
        valueAsNumber
        required
      />
      <ControlledInput
        control={control}
        name="compareAtPriceMinor"
        label="Compare-at price"
        type="number"
        min={0}
        valueAsNumber
        emptyAsUndefined
      />
      <ControlledInput
        control={control}
        name="powerRatingW"
        label="Power rating (W)"
        type="number"
        min={0}
        valueAsNumber
        emptyAsUndefined
      />
      <ControlledInput
        control={control}
        name="voltageV"
        label="Voltage (V)"
        type="number"
        min={0}
        valueAsNumber
        emptyAsUndefined
      />
      <ControlledInput
        control={control}
        name="capacityWh"
        label="Capacity (Wh)"
        type="number"
        min={0}
        valueAsNumber
        emptyAsUndefined
      />
      <ControlledSelect
        control={control}
        name="phase"
        label="Phase"
        clearValue="none"
        clearLabel="Not specified"
        emptyAsUndefined
        options={[
          { value: "SINGLE", label: "Single phase" },
          { value: "THREE", label: "Three phase" },
        ]}
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
  );
}

function EditVariantFields({ control }: { control: Control<EditValues> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ControlledInput control={control} name="sku" label="SKU" required />
      <ControlledInput
        control={control}
        name="variantLabel"
        label="Variant label"
        emptyAsNull
      />
      <ControlledInput
        control={control}
        name="priceMinor"
        label="Price (minor units)"
        type="number"
        min={0}
        valueAsNumber
        required
      />
      <ControlledInput
        control={control}
        name="compareAtPriceMinor"
        label="Compare-at price"
        type="number"
        min={0}
        valueAsNumber
        emptyAsNull
      />
      <ControlledInput
        control={control}
        name="powerRatingW"
        label="Power rating (W)"
        type="number"
        min={0}
        valueAsNumber
        emptyAsNull
      />
      <ControlledInput
        control={control}
        name="voltageV"
        label="Voltage (V)"
        type="number"
        min={0}
        valueAsNumber
        emptyAsNull
      />
      <ControlledInput
        control={control}
        name="capacityWh"
        label="Capacity (Wh)"
        type="number"
        min={0}
        valueAsNumber
        emptyAsNull
      />
      <ControlledSelect
        control={control}
        name="phase"
        label="Phase"
        clearValue="none"
        clearLabel="Not specified"
        options={[
          { value: "SINGLE", label: "Single phase" },
          { value: "THREE", label: "Three phase" },
        ]}
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
  );
}

function CreateVariantForm({
  productId,
  close,
}: {
  productId: string;
  close: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<CreateValues>({
    resolver: zodResolver(createVariantSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      productId,
      sku: "",
      variantLabel: undefined,
      priceMinor: undefined as unknown as number,
      compareAtPriceMinor: undefined,
      sortOrder: 0,
    },
  });
  const submit = handleSubmit((values) =>
    startTransition(async () => {
      const result = await mutate(
        `/api/admin/catalog/products/${productId}/variants`,
        "POST",
        values as Record<string, unknown>,
      );
      if (!result.ok) {
        toast.error(result.message ?? "Could not add variant.");
        return;
      }
      toast.success("Variant added.");
      close();
      router.refresh();
    }),
  );
  return (
    <form onSubmit={submit} className="space-y-5">
      <CreateVariantFields control={control} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !isValid}>
          {pending ? "Adding…" : "Add variant"}
        </Button>
      </div>
    </form>
  );
}

function EditVariantForm({
  variant,
  close,
}: {
  variant: CatalogVariant;
  close: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<EditValues>({
    resolver: zodResolver(updateVariantSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      sku: variant.sku,
      variantLabel: variant.variantLabel,
      priceMinor: variant.priceMinor,
      compareAtPriceMinor: variant.compareAtPriceMinor,
      sortOrder: variant.sortOrder,
      powerRatingW: variant.powerRatingW,
      voltageV: variant.voltageV,
      capacityWh: variant.capacityWh,
      ratedCurrentA: variant.ratedCurrentA,
      phase: variant.phase,
      efficiencyPercent: variant.efficiencyPercent,
      mpptMinV: variant.mpptMinV,
      mpptMaxV: variant.mpptMaxV,
      weightKg: variant.weightKg,
      lengthCm: variant.lengthCm,
      widthCm: variant.widthCm,
      heightCm: variant.heightCm,
    },
  });
  const submit = handleSubmit((values) =>
    startTransition(async () => {
      const result = await mutate(
        `/api/admin/catalog/variants/${variant.id}`,
        "PATCH",
        values as Record<string, unknown>,
      );
      if (!result.ok) {
        toast.error(result.message ?? "Could not update variant.");
        return;
      }
      toast.success("Variant updated.");
      close();
      router.refresh();
    }),
  );
  return (
    <form onSubmit={submit} className="space-y-5">
      <EditVariantFields control={control} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !isValid}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function VariantRow({
  variant,
  activeVariantCount,
  canUpdate,
}: {
  variant: CatalogVariant;
  activeVariantCount: number;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const dialogKey = `variant-edit-${variant.id}`;
  const dialog = useUrlDialog(dialogKey);
  const [pending, startTransition] = useTransition();
  const canArchive = variant.status === "ACTIVE" && activeVariantCount > 1;
  function run(url: string, method: string, success: string) {
    startTransition(async () => {
      const result = await mutate(url, method);
      if (!result.ok) {
        toast.error(result.message ?? "Request failed.");
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-4 pt-0 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">
              {variant.sku}
              {variant.variantLabel ? ` — ${variant.variantLabel}` : ""}
            </p>
            {variant.isDefault ? (
              <Badge variant="outline">Default</Badge>
            ) : null}
            <Badge
              variant={variant.status === "ACTIVE" ? "default" : "secondary"}
            >
              {variant.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatMinorUnits(variant.priceMinor, variant.currency)}
            {variant.compareAtPriceMinor
              ? ` · was ${formatMinorUnits(variant.compareAtPriceMinor, variant.currency)}`
              : ""}
          </p>
        </div>
        {canUpdate ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => dialog.open()}
            >
              Edit
            </Button>
            {!variant.isDefault && variant.status === "ACTIVE" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    `/api/admin/catalog/variants/${variant.id}/default`,
                    "POST",
                    "Default variant updated.",
                  )
                }
              >
                Set default
              </Button>
            ) : null}
            {variant.status === "ACTIVE" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || !canArchive}
                title={
                  !canArchive
                    ? "A product must always have at least one active variant."
                    : undefined
                }
                onClick={() =>
                  run(
                    `/api/admin/catalog/variants/${variant.id}/archive`,
                    "POST",
                    "Variant archived.",
                  )
                }
              >
                Archive
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    `/api/admin/catalog/variants/${variant.id}/reactivate`,
                    "POST",
                    "Variant reactivated.",
                  )
                }
              >
                Reactivate
              </Button>
            )}
          </div>
        ) : null}
        <UrlDialog
          dialogKey={dialogKey}
          title="Edit variant"
          description="Changes are validated as you type before they reach the catalog use-case."
        >
          {(close) => <EditVariantForm variant={variant} close={close} />}
        </UrlDialog>
      </CardContent>
    </Card>
  );
}

export function VariantManager({
  productId,
  variants,
  canCreate,
  canUpdate,
}: {
  productId: string;
  variants: CatalogVariant[];
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const create = useUrlDialog("variant-create");
  const activeVariantCount = variants.filter(
    (variant) => variant.status === "ACTIVE",
  ).length;
  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button type="button" onClick={() => create.open()}>
            <Plus className="size-4" />
            Add variant
          </Button>
        </div>
      ) : null}
      <div className="grid gap-3">
        {variants.map((variant) => (
          <VariantRow
            key={variant.id}
            variant={variant}
            activeVariantCount={activeVariantCount}
            canUpdate={canUpdate}
          />
        ))}
      </div>
      <UrlDialog
        dialogKey="variant-create"
        title="Add variant"
        description="Create a priced product option with live validation."
      >
        {(close) => <CreateVariantForm productId={productId} close={close} />}
      </UrlDialog>
    </div>
  );
}
