"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  ControlledCheckbox,
  ControlledInput,
  ControlledSearchSelect,
  ControlledSelect,
} from "@/components/forms/controlled-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type {
  CatalogBrand,
  CatalogCategory,
} from "@/src/modules/catalog/types";

export interface ProductFilterValues {
  category?: string;
  brand?: string;
  search?: string;
  minPrice?: string;
  maxPrice?: string;
  powerMin?: string;
  powerMax?: string;
  voltage?: string;
  phase?: string;
  inStock?: string;
  sort?: string;
}

const optionalNonNegative = z.union([
  z.literal(""),
  z.string().regex(/^\d+$/, "Enter a whole number of zero or more."),
]);
const productFilterSchema = z
  .object({
    search: z.string().max(120).default(""),
    category: z.string().default("all"),
    brand: z.string().default("all"),
    minPrice: optionalNonNegative.default(""),
    maxPrice: optionalNonNegative.default(""),
    powerMin: optionalNonNegative.default(""),
    powerMax: optionalNonNegative.default(""),
    voltage: optionalNonNegative.default(""),
    phase: z.enum(["any", "SINGLE", "THREE"]).default("any"),
    inStock: z.boolean().default(false),
    sort: z
      .enum(["newest", "featured", "price_asc", "price_desc"])
      .default("newest"),
  })
  .superRefine((value, ctx) => {
    if (
      value.minPrice &&
      value.maxPrice &&
      Number(value.minPrice) > Number(value.maxPrice)
    )
      ctx.addIssue({
        code: "custom",
        path: ["maxPrice"],
        message: "Maximum price must be at least the minimum price.",
      });
    if (
      value.powerMin &&
      value.powerMax &&
      Number(value.powerMin) > Number(value.powerMax)
    )
      ctx.addIssue({
        code: "custom",
        path: ["powerMax"],
        message: "Maximum power must be at least the minimum power.",
      });
  });
type FormValues = z.input<typeof productFilterSchema>;

export function ProductFilterForm({
  categories,
  brands,
  values,
  className,
  showHeader = true,
  onNavigate,
}: {
  categories: CatalogCategory[];
  brands: CatalogBrand[];
  values: ProductFilterValues;
  className?: string;
  showHeader?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const defaults = useMemo<FormValues>(
    () => ({
      search: values.search ?? "",
      category: values.category ?? "all",
      brand: values.brand ?? "all",
      minPrice: values.minPrice ?? "",
      maxPrice: values.maxPrice ?? "",
      powerMin: values.powerMin ?? "",
      powerMax: values.powerMax ?? "",
      voltage: values.voltage ?? "",
      phase:
        values.phase === "SINGLE" || values.phase === "THREE"
          ? values.phase
          : "any",
      inStock: values.inStock === "true",
      sort:
        values.sort === "featured" ||
        values.sort === "price_asc" ||
        values.sort === "price_desc"
          ? values.sort
          : "newest",
    }),
    [
      values.brand,
      values.category,
      values.inStock,
      values.maxPrice,
      values.minPrice,
      values.phase,
      values.powerMax,
      values.powerMin,
      values.search,
      values.sort,
      values.voltage,
    ],
  );
  const {
    control,
    handleSubmit,
    reset,
    formState: { isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(productFilterSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: defaults,
  });

  // The query string is the committed filter state. App Router can preserve
  // this client component across Back/Forward navigation, so RHF's one-time
  // `defaultValues` are not enough: resync whenever the server supplies values
  // parsed from a new URL.
  useEffect(() => {
    reset(defaults);
  }, [defaults, reset]);

  const submit = handleSubmit((next) => {
    const params = new URLSearchParams();
    for (const key of [
      "search",
      "minPrice",
      "maxPrice",
      "powerMin",
      "powerMax",
      "voltage",
    ] as const)
      if (next[key]) params.set(key, next[key]);
    if (next.category && next.category !== "all")
      params.set("category", next.category);
    if (next.brand && next.brand !== "all") params.set("brand", next.brand);
    if (next.phase && next.phase !== "any") params.set("phase", next.phase);
    if (next.inStock) params.set("inStock", "true");
    if (next.sort && next.sort !== "newest") params.set("sort", next.sort);
    router.push(params.size ? `/products?${params.toString()}` : "/products", {
      scroll: false,
    });
    onNavigate?.();
  });

  function clear() {
    const clean: FormValues = {
      search: "",
      category: "all",
      brand: "all",
      minPrice: "",
      maxPrice: "",
      powerMin: "",
      powerMax: "",
      voltage: "",
      phase: "any",
      inStock: false,
      sort: "newest",
    };
    reset(clean);
    router.push("/products", { scroll: false });
    onNavigate?.();
  }

  const hasActiveFilters = countActiveFilters(values) > 0;

  return (
    <form onSubmit={submit} noValidate>
      <Card size="sm" className={cn("gap-0 shadow-none", className)}>
        {showHeader ? (
          <CardHeader className="border-b pb-4">
            <CardTitle>Filters</CardTitle>
            <CardDescription>Refine the equipment shown.</CardDescription>
          </CardHeader>
        ) : null}
        <CardContent className="space-y-5 py-5">
          <ControlledInput
            control={control}
            name="search"
            label="Search"
            type="search"
            placeholder="Panels, inverters, batteries…"
          />
          <ControlledSearchSelect
            control={control}
            name="category"
            label="Category"
            options={categories.map((item) => ({
              value: item.slug,
              label: item.name,
            }))}
            clearValue="all"
            clearLabel="All categories"
            clearResult="value"
            placeholder="All categories"
          />
          <ControlledSearchSelect
            control={control}
            name="brand"
            label="Brand"
            options={brands.map((item) => ({
              value: item.slug,
              label: item.name,
            }))}
            clearValue="all"
            clearLabel="All brands"
            clearResult="value"
            placeholder="All brands"
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Price range (₦)</legend>
            <div className="grid grid-cols-2 gap-3">
              <ControlledInput
                control={control}
                name="minPrice"
                label="Minimum"
                inputMode="numeric"
              />
              <ControlledInput
                control={control}
                name="maxPrice"
                label="Maximum"
                inputMode="numeric"
              />
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Power range (W)</legend>
            <div className="grid grid-cols-2 gap-3">
              <ControlledInput
                control={control}
                name="powerMin"
                label="Minimum"
                inputMode="numeric"
              />
              <ControlledInput
                control={control}
                name="powerMax"
                label="Maximum"
                inputMode="numeric"
              />
            </div>
          </fieldset>
          <ControlledInput
            control={control}
            name="voltage"
            label="Voltage (V)"
            inputMode="numeric"
          />
          <ControlledSelect
            control={control}
            name="phase"
            label="Phase"
            options={[
              { value: "SINGLE", label: "Single-phase" },
              { value: "THREE", label: "Three-phase" },
            ]}
            clearValue="any"
            clearLabel="Any phase"
            clearResult="value"
          />
          <ControlledCheckbox
            control={control}
            name="inStock"
            label="In-stock products only"
          />
          <ControlledSelect
            control={control}
            name="sort"
            label="Sort by"
            options={[
              { value: "newest", label: "Newest" },
              { value: "featured", label: "Featured first" },
              { value: "price_asc", label: "Price: low to high" },
              { value: "price_desc", label: "Price: high to low" },
            ]}
          />
        </CardContent>
        <CardFooter className="grid gap-2 border-t pt-4">
          <Button type="submit" disabled={!isValid} className="w-full">
            <Search className="size-4" />
            Apply filters
          </Button>
          {hasActiveFilters ? (
            <Button type="button" variant="outline" onClick={clear}>
              <RotateCcw className="size-4" />
              Clear filters
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </form>
  );
}

function countActiveFilters(values: ProductFilterValues) {
  return [
    values.search,
    values.category && values.category !== "all" ? values.category : "",
    values.brand && values.brand !== "all" ? values.brand : "",
    values.minPrice,
    values.maxPrice,
    values.powerMin,
    values.powerMax,
    values.voltage,
    values.phase && values.phase !== "any" ? values.phase : "",
    values.inStock === "true" ? "inStock" : "",
  ].filter(Boolean).length;
}

export function ProductFilterDrawer({
  categories,
  brands,
  values,
}: {
  categories: CatalogCategory[];
  brands: CatalogBrand[];
  values: ProductFilterValues;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = countActiveFilters(values);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            className="md:hidden"
            aria-label="Filter products"
          />
        }
      >
        <SlidersHorizontal aria-hidden="true" />
        Filters
        {activeCount > 0 ? (
          <Badge variant="secondary">{activeCount}</Badge>
        ) : null}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[min(92vw,24rem)] gap-0 bg-background text-foreground"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Filter products</SheetTitle>
          <SheetDescription>
            Narrow the catalog by equipment details and availability.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ProductFilterForm
            categories={categories}
            brands={brands}
            values={values}
            showHeader={false}
            className="border-0 bg-transparent shadow-none"
            onNavigate={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
