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
  ControlledSearchSelect,
  ControlledTextarea,
  FieldShell,
  type SelectOption,
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
  createCategorySchema,
  updateCategorySchema,
} from "@/src/modules/catalog/schema";
import type { CategoryTreeNode } from "@/src/modules/catalog/types";

type CreateValues = z.input<typeof createCategorySchema>;
type UpdateValues = z.input<typeof updateCategorySchema>;

type FlatCategory = Omit<CategoryTreeNode, "children"> & { depth: number };

function flatten(nodes: CategoryTreeNode[], depth = 0): FlatCategory[] {
  return nodes.flatMap(({ children, ...node }) => [
    { ...node, depth },
    ...flatten(children, depth + 1),
  ]);
}

async function mutate(
  url: string,
  method: string,
  body?: Record<string, unknown>,
) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body
      ? JSON.stringify(body, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        )
      : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      payload?.issues?.[0] ?? payload?.error ?? "Request failed.",
    );
  return payload;
}

function parentOptions(
  categories: FlatCategory[],
  excludeId?: string,
): SelectOption[] {
  return categories
    .filter((category) => category.id !== excludeId)
    .map((category) => ({
      value: category.id,
      label: `${"— ".repeat(category.depth)}${category.name}`,
      keywords: category.slug,
    }));
}

function CreateCategoryDialog({ categories }: { categories: FlatCategory[] }) {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, isValid },
  } = useForm<CreateValues>({
    resolver: zodResolver(createCategorySchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      name: "",
      slug: undefined,
      description: undefined,
      imageUrl: undefined,
      parentId: undefined,
      sortOrder: 0,
      isActive: true,
      seoTitle: undefined,
      seoDescription: undefined,
    },
  });
  const imageUrl = useWatch({ control, name: "imageUrl" });

  return (
    <UrlDialog
      dialogKey="category-create"
      title="Create category"
      description="Add a catalog category. Parent categories are searchable and validation updates as you type."
      className="sm:max-w-2xl"
    >
      {(close) => (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={handleSubmit(async (values) => {
            try {
              await mutate(
                "/api/admin/catalog/categories",
                "POST",
                values as Record<string, unknown>,
              );
              toast.success("Category created.");
              close();
              router.refresh();
            } catch (error) {
              toast.error("Could not create category", {
                description:
                  error instanceof Error ? error.message : "Please try again.",
              });
            }
          })}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <ControlledInput
              control={control}
              name="name"
              label="Category name"
              required
              autoFocus
            />
            <ControlledInput
              control={control}
              name="slug"
              label="Slug"
              description="Optional; generated from the name when blank."
              emptyAsUndefined
            />
            <ControlledSearchSelect
              control={control}
              name="parentId"
              label="Parent category"
              options={parentOptions(categories)}
              clearValue="none"
              clearLabel="No parent (top level)"
              placeholder="No parent (top level)"
              className="sm:col-span-2"
            />
            <ControlledInput
              control={control}
              name="sortOrder"
              label="Sort order"
              type="number"
              min="0"
              step="1"
              valueAsNumber
            />
            <ControlledInput
              control={control}
              name="seoTitle"
              label="SEO title"
              emptyAsUndefined
            />
            <ControlledTextarea
              control={control}
              name="description"
              label="Description"
              rows={3}
              emptyAsUndefined
              className="sm:col-span-2"
            />
            <ControlledTextarea
              control={control}
              name="seoDescription"
              label="SEO description"
              rows={2}
              emptyAsUndefined
              className="sm:col-span-2"
            />
            <FieldShell
              id="category-image"
              label="Category image"
              description="Upload to Watplux media or paste a supported URL."
              className="sm:col-span-2"
            >
              <MediaImageField
                value={typeof imageUrl === "string" ? imageUrl : ""}
                onValueChange={(value) =>
                  setValue("imageUrl", value || undefined, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
            </FieldShell>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !isValid}>
              {isSubmitting ? "Creating…" : "Create category"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </UrlDialog>
  );
}

function EditCategoryDialog({
  category,
  categories,
}: {
  category: FlatCategory | null;
  categories: FlatCategory[];
}) {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, isValid },
  } = useForm<UpdateValues>({
    resolver: zodResolver(updateCategorySchema),
    mode: "onChange",
    reValidateMode: "onChange",
    values: category
      ? {
          name: category.name,
          slug: category.slug,
          description: category.description,
          imageUrl: category.imageUrl,
          parentId: category.parentId,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          seoTitle: category.seoTitle,
          seoDescription: category.seoDescription,
        }
      : {},
  });
  const imageUrl = useWatch({ control, name: "imageUrl" });
  if (!category) return null;

  return (
    <UrlDialog
      dialogKey="category-edit"
      title="Edit category"
      description={`Update ${category.name}. Server-side cycle detection still protects parent changes.`}
      className="sm:max-w-2xl"
    >
      {(close) => (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={handleSubmit(async (values) => {
            try {
              await mutate(
                `/api/admin/catalog/categories/${category.id}`,
                "PATCH",
                values as Record<string, unknown>,
              );
              toast.success("Category updated.");
              close();
              router.refresh();
            } catch (error) {
              toast.error("Could not update category", {
                description:
                  error instanceof Error ? error.message : "Please try again.",
              });
            }
          })}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <ControlledInput
              control={control}
              name="name"
              label="Category name"
              required
            />
            <ControlledInput
              control={control}
              name="slug"
              label="Slug"
              emptyAsUndefined
            />
            <ControlledSearchSelect
              control={control}
              name="parentId"
              label="Parent category"
              options={parentOptions(categories, category.id)}
              clearValue="none"
              clearLabel="No parent (top level)"
              placeholder="No parent (top level)"
              className="sm:col-span-2"
            />
            <ControlledInput
              control={control}
              name="sortOrder"
              label="Sort order"
              type="number"
              min="0"
              step="1"
              valueAsNumber
            />
            <ControlledInput
              control={control}
              name="seoTitle"
              label="SEO title"
              emptyAsNull
            />
            <ControlledTextarea
              control={control}
              name="description"
              label="Description"
              rows={3}
              emptyAsNull
              className="sm:col-span-2"
            />
            <ControlledTextarea
              control={control}
              name="seoDescription"
              label="SEO description"
              rows={2}
              emptyAsNull
              className="sm:col-span-2"
            />
            <FieldShell
              id="edit-category-image"
              label="Category image"
              description="Upload to Watplux media or paste a supported URL."
              className="sm:col-span-2"
            >
              <MediaImageField
                value={typeof imageUrl === "string" ? imageUrl : ""}
                onValueChange={(value) =>
                  setValue("imageUrl", value || null, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
            </FieldShell>
          </div>
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

export function CategoryManager({
  tree,
  canCreate,
  canUpdate,
}: {
  tree: CategoryTreeNode[];
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const createDialog = useUrlDialog("category-create");
  const editDialog = useUrlDialog("category-edit");
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const categories = useMemo(() => flatten(tree), [tree]);
  const selected =
    categories.find(
      (item) => item.id === editDialog.searchParams.get("item"),
    ) ?? null;
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? categories.filter((category) =>
          `${category.name} ${category.slug}`.toLowerCase().includes(needle),
        )
      : categories;
  }, [categories, search]);

  function toggle(category: FlatCategory) {
    startTransition(async () => {
      try {
        await mutate(
          `/api/admin/catalog/categories/${category.id}/${category.isActive ? "deactivate" : "activate"}`,
          "POST",
        );
        toast.success(
          category.isActive ? "Category deactivated." : "Category activated.",
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
        searchPlaceholder="Search categories"
        createLabel={canCreate ? "New category" : undefined}
        onCreate={canCreate ? () => createDialog.open() : undefined}
      />
      {visible.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((category) => (
            <Card key={category.id} size="sm">
              <CardHeader>
                <CardTitle>
                  <span className="text-muted-foreground">
                    {"— ".repeat(category.depth)}
                  </span>
                  {category.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  /{category.slug}
                </p>
                <CardAction>
                  <Badge variant={category.isActive ? "default" : "secondary"}>
                    {category.isActive ? "Active" : "Inactive"}
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
                      onClick={() => editDialog.open({ item: category.id })}
                    >
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => toggle(category)}
                    >
                      <Power className="size-4" />
                      {category.isActive ? "Deactivate" : "Activate"}
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
            No categories match your search.
          </CardContent>
        </Card>
      )}
      <CreateCategoryDialog categories={categories} />
      <EditCategoryDialog category={selected} categories={categories} />
    </div>
  );
}
