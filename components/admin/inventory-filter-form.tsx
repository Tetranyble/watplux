"use client";
import { QueryFilterForm } from "@/components/forms/query-filter-form";
export function InventoryFilterForm({
  lowStockOnly,
}: {
  lowStockOnly: boolean;
}) {
  return (
    <QueryFilterForm
      values={{ lowStockOnly }}
      fields={[
        { name: "lowStockOnly", label: "Low stock only", kind: "checkbox" },
      ]}
    />
  );
}
