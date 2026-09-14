"use client";

import { QueryFilterForm } from "@/components/forms/query-filter-form";

const PRODUCT_STATUS_OPTIONS = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export interface AdminProductFilterValues {
  status?: string;
  search?: string;
  includeDeleted: boolean;
}

export function ProductFilterForm({
  values,
}: {
  values: AdminProductFilterValues;
}) {
  return (
    <QueryFilterForm
      values={{
        status: values.status ?? "",
        search: values.search ?? "",
        includeDeleted: values.includeDeleted,
      }}
      fields={[
        {
          name: "search",
          label: "Search",
          kind: "search",
          placeholder: "Product, brand, category or SKU",
          className: "sm:col-span-2",
        },
        {
          name: "status",
          label: "Status",
          kind: "select",
          options: PRODUCT_STATUS_OPTIONS.map((status) => ({
            value: status,
            label: status.replaceAll("_", " "),
          })),
          allLabel: "All statuses",
        },
        { name: "includeDeleted", label: "Include deleted", kind: "checkbox" },
      ]}
      createHref="/admin/catalog/products/new"
      createLabel="New product"
    />
  );
}
