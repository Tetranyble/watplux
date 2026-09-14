"use client";

import { Filter, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import {
  ControlledCheckbox,
  ControlledInput,
  ControlledSelect,
  type SelectOption,
} from "@/components/forms/controlled-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type FilterValue = string | boolean;
type FilterValues = Record<string, FilterValue>;

type FilterField =
  | {
      name: string;
      label: string;
      kind?: "text" | "search" | "date" | "email" | "number";
      placeholder?: string;
      className?: string;
    }
  | {
      name: string;
      label: string;
      kind: "select";
      options: readonly SelectOption[];
      allValue?: string;
      allLabel?: string;
      className?: string;
    }
  | { name: string; label: string; kind: "checkbox"; className?: string };

export function QueryFilterForm({
  values,
  fields,
  basePath,
  createHref,
  createLabel,
  className,
}: {
  values: FilterValues;
  fields: FilterField[];
  basePath?: string;
  createHref?: string;
  createLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const path = basePath ?? pathname;
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<FilterValues>({
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: values,
  });

  function submit(next: FilterValues) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (typeof value === "boolean") {
        if (value) params.set(key, "true");
      } else if (value.trim() && value !== "all") {
        params.set(key, value.trim());
      }
    }
    router.push(params.size ? `${path}?${params.toString()}` : path, {
      scroll: false,
    });
  }

  function clear() {
    const cleared = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        typeof value === "boolean" ? false : "",
      ]),
    ) as FilterValues;
    reset(cleared);
    router.push(path, { scroll: false });
  }

  const hasValues = Object.values(values).some((value) =>
    typeof value === "boolean" ? value : Boolean(value && value !== "all"),
  );

  return (
    <Card size="sm" className={className}>
      <CardContent
        className={cn(
          "grid gap-3 pt-0 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5",
        )}
      >
        {fields.map((field) => {
          if (field.kind === "select") {
            return (
              <ControlledSelect
                key={field.name}
                control={control}
                name={field.name}
                label={field.label}
                options={field.options}
                clearValue={field.allValue ?? "all"}
                clearLabel={field.allLabel ?? "All"}
                clearResult="value"
                className={field.className}
              />
            );
          }
          if (field.kind === "checkbox") {
            return (
              <ControlledCheckbox
                key={field.name}
                control={control}
                name={field.name}
                label={field.label}
                className={field.className}
              />
            );
          }
          return (
            <ControlledInput
              key={field.name}
              control={control}
              name={field.name}
              label={field.label}
              type={field.kind ?? "text"}
              placeholder={field.placeholder}
              className={field.className}
            />
          );
        })}
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-full">
          <Button
            type="button"
            onClick={handleSubmit(submit)}
            disabled={isSubmitting}
          >
            {fields.some((field) => field.kind === "search") ? (
              <Search className="size-4" />
            ) : (
              <Filter className="size-4" />
            )}
            Apply filters
          </Button>
          {hasValues ? (
            <Button type="button" variant="outline" onClick={clear}>
              <RotateCcw className="size-4" />
              Clear
            </Button>
          ) : null}
          {createHref && createLabel ? (
            <Button
              nativeButton={false}
              render={<Link href={createHref} />}
              className="sm:ml-auto"
            >
              {createLabel}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
