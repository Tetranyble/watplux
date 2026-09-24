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
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

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

function buildProductFilterSchema(copy: (key: string) => string) {
  const optionalNonNegative = z.union([
    z.literal(""),
    z.string().regex(/^\d+$/, copy("catalog.filters.wholeNumber")),
  ]);
  return z
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
          message: copy("catalog.filters.maxPrice"),
        });
      if (
        value.powerMin &&
        value.powerMax &&
        Number(value.powerMin) > Number(value.powerMax)
      )
        ctx.addIssue({
          code: "custom",
          path: ["powerMax"],
          message: copy("catalog.filters.maxPower"),
        });
    });
}
type FormValues = z.input<ReturnType<typeof buildProductFilterSchema>>;

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
  const copy = useSiteCopy();
  const productFilterSchema = useMemo(
    () => buildProductFilterSchema(copy),
    [copy],
  );
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
            <CardTitle>{copy("catalog.filters.title")}</CardTitle>
            <CardDescription>
              {copy("catalog.filters.description")}
            </CardDescription>
          </CardHeader>
        ) : null}
        <CardContent className="space-y-5 py-5">
          <ControlledInput
            control={control}
            name="search"
            label={copy("catalog.filters.search")}
            type="search"
            placeholder={copy("catalog.filters.searchPlaceholder")}
          />
          <ControlledSearchSelect
            control={control}
            name="category"
            label={copy("catalog.filters.category")}
            options={categories.map((item) => ({
              value: item.slug,
              label: item.name,
            }))}
            clearValue="all"
            clearLabel={copy("catalog.filters.allCategories")}
            clearResult="value"
            placeholder={copy("catalog.filters.allCategories")}
          />
          <ControlledSearchSelect
            control={control}
            name="brand"
            label={copy("catalog.filters.brand")}
            options={brands.map((item) => ({
              value: item.slug,
              label: item.name,
            }))}
            clearValue="all"
            clearLabel={copy("catalog.filters.allBrands")}
            clearResult="value"
            placeholder={copy("catalog.filters.allBrands")}
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {copy("catalog.filters.priceRange")}
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <ControlledInput
                control={control}
                name="minPrice"
                label={copy("catalog.filters.minimum")}
                inputMode="numeric"
              />
              <ControlledInput
                control={control}
                name="maxPrice"
                label={copy("catalog.filters.maximum")}
                inputMode="numeric"
              />
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {copy("catalog.filters.powerRange")}
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <ControlledInput
                control={control}
                name="powerMin"
                label={copy("catalog.filters.minimum")}
                inputMode="numeric"
              />
              <ControlledInput
                control={control}
                name="powerMax"
                label={copy("catalog.filters.maximum")}
                inputMode="numeric"
              />
            </div>
          </fieldset>
          <ControlledInput
            control={control}
            name="voltage"
            label={copy("catalog.filters.voltage")}
            inputMode="numeric"
          />
          <ControlledSelect
            control={control}
            name="phase"
            label={copy("catalog.filters.phase")}
            options={[
              { value: "SINGLE", label: copy("catalog.filters.singlePhase") },
              { value: "THREE", label: copy("catalog.filters.threePhase") },
            ]}
            clearValue="any"
            clearLabel={copy("catalog.filters.anyPhase")}
            clearResult="value"
          />
          <ControlledCheckbox
            control={control}
            name="inStock"
            label={copy("catalog.filters.stock")}
          />
          <ControlledSelect
            control={control}
            name="sort"
            label={copy("catalog.filters.sort")}
            options={[
              { value: "newest", label: copy("catalog.filters.newest") },
              { value: "featured", label: copy("catalog.filters.featured") },
              { value: "price_asc", label: copy("catalog.filters.priceAsc") },
              { value: "price_desc", label: copy("catalog.filters.priceDesc") },
            ]}
          />
        </CardContent>
        <CardFooter className="grid gap-2 border-t pt-4">
          <Button type="submit" disabled={!isValid} className="w-full">
            <Search className="size-4" />
            {copy("catalog.filters.apply")}
          </Button>
          {hasActiveFilters ? (
            <Button type="button" variant="outline" onClick={clear}>
              <RotateCcw className="size-4" />
              {copy("catalog.filters.clear")}
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
  const copy = useSiteCopy();
  const [open, setOpen] = useState(false);
  const activeCount = countActiveFilters(values);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            className="md:hidden"
            aria-label={copy("catalog.filters.filterAria")}
          />
        }
      >
        <SlidersHorizontal aria-hidden="true" />
        {copy("catalog.filters.title")}
        {activeCount > 0 ? (
          <Badge variant="secondary">{activeCount}</Badge>
        ) : null}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[min(92vw,24rem)] gap-0 bg-background text-foreground"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{copy("catalog.filters.drawerTitle")}</SheetTitle>
          <SheetDescription>
            {copy("catalog.filters.drawerDescription")}
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
