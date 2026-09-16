"use client";

import { Filter, RotateCcw, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import {
  ControlledCheckbox,
  ControlledInput,
  ControlledSelect,
  type SelectOption,
} from "@/components/forms/controlled-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
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
  className,
}: {
  values: FilterValues;
  fields: FilterField[];
  basePath?: string;
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
    <form onSubmit={handleSubmit(submit)} noValidate>
      <Card size="sm" className={className}>
        <CardContent className="grid gap-4 pt-0 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
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
                  compact
                  className={cn("self-end", field.className)}
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
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto"
          >
            {fields.some((field) => field.kind === "search") ? (
              <Search className="size-4" />
            ) : (
              <Filter className="size-4" />
            )}
            Apply filters
          </Button>
          {hasValues ? (
            <Button
              type="button"
              variant="outline"
              onClick={clear}
              className="w-full sm:w-auto"
            >
              <RotateCcw className="size-4" />
              Clear
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </form>
  );
}
