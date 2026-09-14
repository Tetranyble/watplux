"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Power } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "@/components/ui/toast";
import type { z } from "zod";

import {
  ControlledInput,
  ControlledTextarea,
  FieldShell,
} from "@/components/forms/controlled-fields";
import { ResourceToolbar } from "@/components/forms/resource-toolbar";
import { MediaImageField } from "@/components/admin/media-image-field";
import { UrlDialog, useUrlDialog } from "@/components/router/url-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DialogFooter } from "@/components/ui/dialog";
import {
  createBrandSchema,
  updateBrandSchema,
} from "@/src/modules/catalog/schema";
import type { CatalogBrand } from "@/src/modules/catalog/types";

type CreateValues = z.input<typeof createBrandSchema>;
type UpdateValues = z.input<typeof updateBrandSchema>;

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
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      payload?.issues?.[0] ?? payload?.error ?? "Request failed.",
    );
  return payload;
}

function CreateBrandDialog({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, isValid },
  } = useForm<CreateValues>({
    resolver: zodResolver(createBrandSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      name: "",
      slug: undefined,
      logoUrl: undefined,
      description: undefined,
    },
  });
  return (
    <UrlDialog
      dialogKey="brand-create"
      title="Create brand"
      description="Add a reusable brand to the catalog. Validation updates as you type."
    >
      {(close) => (
        <form
          onSubmit={handleSubmit(async (values) => {
            try {
              await mutate(
                "/api/admin/catalog/brands",
                "POST",
                values as Record<string, unknown>,
              );
              toast.success("Brand created.");
              close();
              onDone();
              router.refresh();
            } catch (error) {
              toast.error("Could not create brand", {
                description:
                  error instanceof Error ? error.message : "Please try again.",
              });
            }
          })}
          className="grid gap-4"
          noValidate
        >
          <ControlledInput
            control={control}
            name="name"
            label="Brand name"
            required
            autoFocus
          />
          <ControlledInput
            control={control}
            name="slug"
            label="Slug"
            description="Optional. Leave blank to derive it from the name."
            emptyAsUndefined
          />
          <ControlledTextarea
            control={control}
            name="description"
            label="Description"
            rows={3}
            emptyAsUndefined
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !isValid}>
              {isSubmitting ? "Creating…" : "Create brand"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </UrlDialog>
  );
}

function EditBrandDialog({
  brand,
  onDone,
}: {
  brand: CatalogBrand | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, isValid },
  } = useForm<UpdateValues>({
    resolver: zodResolver(updateBrandSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    values: brand
      ? {
          name: brand.name,
          slug: brand.slug,
          logoUrl: brand.logoUrl ?? null,
          description: brand.description ?? null,
        }
      : {},
  });
  const logoUrl = useWatch({ control, name: "logoUrl" });
  if (!brand) return null;
  return (
    <UrlDialog
      dialogKey="brand-edit"
      title="Edit brand"
      description={`Update ${brand.name}. Changes are validated before submission.`}
    >
      {(close) => (
        <form
          onSubmit={handleSubmit(async (values) => {
            try {
              await mutate(
                `/api/admin/catalog/brands/${brand.id}`,
                "PATCH",
                values as Record<string, unknown>,
              );
              toast.success("Brand updated.");
              close();
              onDone();
              router.refresh();
            } catch (error) {
              toast.error("Could not update brand", {
                description:
                  error instanceof Error ? error.message : "Please try again.",
              });
            }
          })}
          className="grid gap-4"
          noValidate
        >
          <ControlledInput
            control={control}
            name="name"
            label="Brand name"
            required
          />
          <ControlledInput
            control={control}
            name="slug"
            label="Slug"
            emptyAsUndefined
          />
          <ControlledTextarea
            control={control}
            name="description"
            label="Description"
            rows={3}
            emptyAsNull
          />
          <FieldShell
            id="brand-logo"
            label="Brand logo"
            description="Upload to Watplux media or paste a supported URL."
          >
            <MediaImageField
              value={typeof logoUrl === "string" ? logoUrl : ""}
              onValueChange={(value) =>
                setValue("logoUrl", value || null, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
          </FieldShell>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !isValid}>
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </UrlDialog>
  );
}

export function BrandManager({
  brands,
  canCreate,
  canUpdate,
}: {
  brands: CatalogBrand[];
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const createDialog = useUrlDialog("brand-create");
  const editDialog = useUrlDialog("brand-edit");
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const selected =
    brands.find((item) => item.id === editDialog.searchParams.get("item")) ??
    null;
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? brands.filter((brand) =>
          `${brand.name} ${brand.slug}`.toLowerCase().includes(needle),
        )
      : brands;
  }, [brands, search]);

  function toggle(brand: CatalogBrand) {
    startTransition(async () => {
      try {
        await mutate(
          `/api/admin/catalog/brands/${brand.id}/${brand.isActive ? "deactivate" : "activate"}`,
          "POST",
        );
        toast.success(
          brand.isActive ? "Brand deactivated." : "Brand activated.",
        );
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Request failed.");
      }
    });
  }

  return (
    <div className="grid gap-4">
      <ResourceToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search brands"
        createLabel={canCreate ? "New brand" : undefined}
        onCreate={canCreate ? () => createDialog.open() : undefined}
      />
      {visible.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((brand) => (
            <Card key={brand.id} size="sm">
              <CardHeader>
                <CardTitle>{brand.name}</CardTitle>
                <p className="text-xs text-muted-foreground">/{brand.slug}</p>
                <CardAction>
                  <Badge variant={brand.isActive ? "default" : "secondary"}>
                    {brand.isActive ? "Active" : "Inactive"}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {canUpdate ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => editDialog.open({ item: brand.id })}
                    >
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => toggle(brand)}
                    >
                      <Power className="size-4" />
                      {brand.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No brands match your search.
          </CardContent>
        </Card>
      )}
      <CreateBrandDialog onDone={() => setSearch("")} />
      <EditBrandDialog brand={selected} onDone={() => setSearch("")} />
    </div>
  );
}
