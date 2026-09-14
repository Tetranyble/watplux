"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "@/components/ui/toast";
import { z } from "zod";

import {
  ControlledInput,
  ControlledTextarea,
} from "@/components/forms/controlled-fields";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adjustInventorySchema,
  recordInventoryReturnSchema,
  restockInventorySchema,
} from "@/src/modules/inventory/schema";

async function postMutation(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      payload?.issues?.[0] ?? payload?.error ?? "Request failed.",
    );
}

type RestockInput = z.input<typeof restockInventorySchema>;
type RestockOutput = z.output<typeof restockInventorySchema>;
function RestockForm({ variantId }: { variantId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    reset,
    formState: { isValid },
  } = useForm<RestockInput, unknown, RestockOutput>({
    resolver: zodResolver(restockInventorySchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { note: undefined },
  });
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Restock</CardTitle>
        <CardDescription>
          Add received stock to on-hand quantity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          noValidate
          onSubmit={handleSubmit((values) =>
            startTransition(async () => {
              try {
                await postMutation(
                  `/api/admin/inventory/${variantId}/restock`,
                  values,
                );
                toast.success("Restock recorded.");
                reset();
                router.refresh();
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not restock this variant.",
                );
              }
            }),
          )}
        >
          <ControlledInput
            control={control}
            name="quantity"
            label="Quantity received"
            type="number"
            step="0.001"
            min="0.001"
            valueAsNumber
            required
          />
          <ControlledTextarea
            control={control}
            name="note"
            label="Note"
            description="Optional receiving note or supplier reference context."
            rows={3}
            maxLength={2000}
            emptyAsUndefined
          />
          <Button
            type="submit"
            disabled={isPending || !isValid}
            className="justify-self-start"
          >
            {isPending ? "Recording…" : "Record restock"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

type AdjustInput = z.input<typeof adjustInventorySchema>;
type AdjustOutput = z.output<typeof adjustInventorySchema>;
function AdjustForm({ variantId }: { variantId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"delta" | "absolute">("delta");
  const {
    control,
    handleSubmit,
    reset,
    unregister,
    formState: { isValid },
  } = useForm<AdjustInput, unknown, AdjustOutput>({
    resolver: zodResolver(adjustInventorySchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { note: "" },
    shouldUnregister: true,
  });
  function changeMode(next: "delta" | "absolute") {
    setMode(next);
    if (next === "delta") unregister("newQuantity");
    else unregister("delta");
  }
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Adjustment</CardTitle>
        <CardDescription>
          Correct stock with an auditable reason.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          noValidate
          onSubmit={handleSubmit((values) =>
            startTransition(async () => {
              try {
                await postMutation(
                  `/api/admin/inventory/${variantId}/adjust`,
                  values,
                );
                toast.success("Adjustment recorded.");
                reset({ note: "" });
                router.refresh();
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not adjust this variant.",
                );
              }
            }),
          )}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="adjust-mode">Adjustment type</Label>
            <Select
              value={mode}
              onValueChange={(value) =>
                changeMode(value as "delta" | "absolute")
              }
            >
              <SelectTrigger id="adjust-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="delta">Relative change (+/-)</SelectItem>
                <SelectItem value="absolute">
                  Set exact on-hand total
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "delta" ? (
            <ControlledInput
              control={control}
              name="delta"
              label="Change amount"
              description="Use a negative number to reduce stock."
              type="number"
              step="0.001"
              valueAsNumber
              required
            />
          ) : (
            <ControlledInput
              control={control}
              name="newQuantity"
              label="New on-hand total"
              type="number"
              min="0"
              step="0.001"
              valueAsNumber
              required
            />
          )}
          <ControlledTextarea
            control={control}
            name="note"
            label="Reason"
            rows={3}
            maxLength={2000}
            required
          />
          <Button
            type="submit"
            variant="outline"
            disabled={isPending || !isValid}
            className="justify-self-start"
          >
            {isPending ? "Recording…" : "Record adjustment"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

type ReturnInput = z.input<typeof recordInventoryReturnSchema>;
type ReturnOutput = z.output<typeof recordInventoryReturnSchema>;
function ReturnForm({ variantId }: { variantId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    reset,
    formState: { isValid },
  } = useForm<ReturnInput, unknown, ReturnOutput>({
    resolver: zodResolver(recordInventoryReturnSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { note: undefined, orderItemId: undefined },
  });
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Return</CardTitle>
        <CardDescription>Return sellable stock to inventory.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          noValidate
          onSubmit={handleSubmit((values) =>
            startTransition(async () => {
              try {
                await postMutation(
                  `/api/admin/inventory/${variantId}/return`,
                  values,
                );
                toast.success("Return recorded.");
                reset();
                router.refresh();
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not record this return.",
                );
              }
            }),
          )}
        >
          <ControlledInput
            control={control}
            name="quantity"
            label="Quantity returned"
            type="number"
            step="0.001"
            min="0.001"
            valueAsNumber
            required
          />
          <ControlledInput
            control={control}
            name="orderItemId"
            label="Order item ID"
            inputMode="numeric"
            emptyAsUndefined
          />
          <ControlledTextarea
            control={control}
            name="note"
            label="Note"
            rows={3}
            maxLength={2000}
            emptyAsUndefined
          />
          <Button
            type="submit"
            variant="outline"
            disabled={isPending || !isValid}
            className="justify-self-start"
          >
            {isPending ? "Recording…" : "Record return"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function InventoryMutationForms({
  variantId,
  hasExistingItem,
}: {
  variantId: string;
  hasExistingItem: boolean;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <RestockForm variantId={variantId} />
      {hasExistingItem ? (
        <>
          <AdjustForm variantId={variantId} />
          <ReturnForm variantId={variantId} />
        </>
      ) : (
        <Card className="lg:col-span-2">
          <CardContent className="py-8 text-sm text-muted-foreground">
            Adjustments and returns become available after the first restock
            creates an inventory balance.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
