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
import { createProductSchema } from "@/src/modules/catalog/schema";

type ProductFormInput = z.input<typeof createProductSchema>;
type ProductFormOutput = z.output<typeof createProductSchema>;
interface CategoryOption {
  id: string;
  name: string;
  depth: number;
}
interface BrandOption {
  id: string;
  name: string;
}

export function ProductCreateForm({
  categories,
  brands,
}: {
  categories: CategoryOption[];
  brands: BrandOption[];
}) {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, isValid },
  } = useForm<ProductFormInput, unknown, ProductFormOutput>({
    resolver: zodResolver(createProductSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      name: "",
      slug: undefined,
      shortDescription: undefined,
      description: undefined,
      unitOfMeasure: "EACH",
      categoryId: undefined,
      brandId: null,
      warrantyMonths: undefined,
      isFeatured: false,
      seoTitle: undefined,
      seoDescription: undefined,
      variant: { sku: "", variantLabel: undefined, priceMinor: undefined },
    },
  });

  async function onSubmit(data: ProductFormOutput) {
    const response = await fetch("/api/admin/catalog/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      toast.error("Could not create product", {
        description:
          payload?.issues?.[0] ??
          payload?.error ??
          "Please check the form and try again.",
      });
      return;
    }
    const { product } = await response.json();
    toast.success("Product created.");
    router.push(`/admin/catalog/products/${product.id}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Product details</CardTitle>
          <CardDescription>
            Core catalog information. Fields are validated as you type.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ControlledInput
            control={control}
            name="name"
            label="Product name"
            required
            autoFocus
            className="sm:col-span-2"
          />
          <ControlledInput
            control={control}
            name="slug"
            label="Slug"
            description="Optional. Leave blank to derive from the product name."
            emptyAsUndefined
            className="sm:col-span-2"
          />
          <ControlledSearchSelect
            control={control}
            name="categoryId"
            label="Category"
            required
            placeholder="Search categories"
            options={categories.map((category) => ({
              value: category.id,
              label: `${"— ".repeat(category.depth)}${category.name}`,
              keywords: category.name,
            }))}
          />
          <ControlledSearchSelect
            control={control}
            name="brandId"
            label="Brand"
            placeholder="No brand"
            clearValue="none"
            clearLabel="No brand"
            options={brands.map((brand) => ({
              value: brand.id,
              label: brand.name,
            }))}
          />
          <ControlledTextarea
            control={control}
            name="shortDescription"
            label="Short description"
            rows={2}
            maxLength={500}
            emptyAsUndefined
            className="sm:col-span-2"
          />
          <ControlledTextarea
            control={control}
            name="description"
            label="Description"
            rows={6}
            emptyAsUndefined
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
            emptyAsUndefined
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
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="seoDescription"
            label="SEO description"
            emptyAsUndefined
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>First variant</CardTitle>
          <CardDescription>
            Every product needs a sellable variant. This becomes the default
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ControlledInput
            control={control}
            name="variant.sku"
            label="SKU"
            required
          />
          <ControlledInput
            control={control}
            name="variant.variantLabel"
            label="Variant label"
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="variant.priceMinor"
            label="Price (minor units)"
            description="For NGN, 250000 means ₦2,500."
            type="number"
            min="0"
            step="1"
            valueAsNumber
            required
          />
          <ControlledInput
            control={control}
            name="variant.compareAtPriceMinor"
            label="Compare-at price (minor units)"
            type="number"
            min="0"
            step="1"
            valueAsNumber
            emptyAsUndefined
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Electrical specifications</CardTitle>
          <CardDescription>
            Optional structured facets improve filtering and product comparison.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ControlledInput
            control={control}
            name="variant.powerRatingW"
            label="Power rating (W)"
            type="number"
            min="0"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="variant.voltageV"
            label="Voltage (V)"
            type="number"
            min="0"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="variant.capacityWh"
            label="Capacity (Wh)"
            type="number"
            min="0"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="variant.ratedCurrentA"
            label="Rated current (A)"
            type="number"
            min="0"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledSelect
            control={control}
            name="variant.phase"
            label="Phase"
            clearValue="none"
            clearLabel="Not specified"
            emptyAsUndefined
            options={[
              { value: "SINGLE", label: "Single-phase" },
              { value: "THREE", label: "Three-phase" },
            ]}
          />
          <ControlledInput
            control={control}
            name="variant.efficiencyPercent"
            label="Efficiency (%)"
            type="number"
            min="0"
            max="100"
            step="0.1"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="variant.mpptMinV"
            label="MPPT minimum (V)"
            type="number"
            min="0"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="variant.mpptMaxV"
            label="MPPT maximum (V)"
            type="number"
            min="0"
            valueAsNumber
            emptyAsUndefined
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logistics</CardTitle>
          <CardDescription>
            Optional dimensions used for fulfilment planning.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ControlledInput
            control={control}
            name="variant.weightKg"
            label="Weight (kg)"
            type="number"
            min="0"
            step="0.001"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="variant.lengthCm"
            label="Length (cm)"
            type="number"
            min="0"
            step="0.01"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="variant.widthCm"
            label="Width (cm)"
            type="number"
            min="0"
            step="0.01"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="variant.heightCm"
            label="Height (cm)"
            type="number"
            min="0"
            step="0.01"
            valueAsNumber
            emptyAsUndefined
          />
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex justify-end rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
        <Button type="submit" size="lg" disabled={isSubmitting || !isValid}>
          {isSubmitting ? "Creating product…" : "Create product"}
        </Button>
      </div>
    </form>
  );
}
