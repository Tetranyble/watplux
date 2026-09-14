"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "@/components/ui/toast";
import type { z } from "zod";

import {
  ControlledCheckbox,
  ControlledInput,
  ControlledSearchSelect,
  ControlledSelect,
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
import { updateProductSchema } from "@/src/modules/catalog/schema";
import type { ProductDetail } from "@/src/modules/catalog/types";

type InputValues = z.input<typeof updateProductSchema>;
type OutputValues = z.output<typeof updateProductSchema>;
interface CategoryOption {
  id: string;
  name: string;
  depth: number;
}
interface BrandOption {
  id: string;
  name: string;
}

export function ProductEditForm({
  product,
  categories,
  brands,
}: {
  product: ProductDetail;
  categories: CategoryOption[];
  brands: BrandOption[];
}) {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, isValid, isDirty },
  } = useForm<InputValues, unknown, OutputValues>({
    resolver: zodResolver(updateProductSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      name: product.name,
      slug: product.slug,
      shortDescription: product.shortDescription ?? undefined,
      description: product.description ?? undefined,
      unitOfMeasure: product.unitOfMeasure,
      categoryId: product.category.id,
      brandId: product.brand?.id ?? null,
      warrantyMonths: product.warrantyMonths ?? undefined,
      isFeatured: product.isFeatured,
      seoTitle: product.seoTitle ?? undefined,
      seoDescription: product.seoDescription ?? undefined,
    },
  });

  async function onSubmit(data: OutputValues) {
    const response = await fetch(`/api/admin/catalog/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      toast.error("Could not save product", {
        description:
          payload?.issues?.[0] ??
          payload?.error ??
          "Please check the form and try again.",
      });
      return;
    }
    toast.success("Product saved.");
    reset(data as InputValues);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Product details</CardTitle>
          <CardDescription>
            Edit the catalog record. Validation updates immediately while you
            work.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ControlledInput
            control={control}
            name="name"
            label="Product name"
            required
            className="sm:col-span-2"
          />
          <ControlledInput
            control={control}
            name="slug"
            label="Slug"
            emptyAsUndefined
            className="sm:col-span-2"
          />
          <ControlledSearchSelect
            control={control}
            name="categoryId"
            label="Category"
            options={categories.map((item) => ({
              value: item.id,
              label: `${"— ".repeat(item.depth)}${item.name}`,
            }))}
          />
          <ControlledSearchSelect
            control={control}
            name="brandId"
            label="Brand"
            clearValue="none"
            clearLabel="No brand"
            options={brands.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <ControlledTextarea
            control={control}
            name="shortDescription"
            label="Short description"
            rows={2}
            emptyAsNull
            className="sm:col-span-2"
          />
          <ControlledTextarea
            control={control}
            name="description"
            label="Description"
            rows={6}
            emptyAsNull
            className="sm:col-span-2"
          />
          <ControlledSelect
            control={control}
            name="unitOfMeasure"
            label="Unit of measure"
            options={[
              { value: "EACH", label: "Each" },
              { value: "METER", label: "Meter" },
            ]}
          />
          <ControlledInput
            control={control}
            name="warrantyMonths"
            label="Warranty (months)"
            type="number"
            min="0"
            step="1"
            valueAsNumber
            emptyAsNull
          />
          <ControlledCheckbox
            control={control}
            name="isFeatured"
            label="Feature this product in promoted catalog surfaces"
            className="sm:col-span-2"
          />
          <ControlledInput
            control={control}
            name="seoTitle"
            label="SEO title"
            emptyAsNull
          />
          <ControlledInput
            control={control}
            name="seoDescription"
            label="SEO description"
            emptyAsNull
          />
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting || !isValid || !isDirty}>
          {isSubmitting ? "Saving…" : isDirty ? "Save changes" : "Saved"}
        </Button>
      </div>
    </form>
  );
}
