"use client";

import { QueryFilterForm } from "@/components/forms/query-filter-form";

export function CustomerFilterForm({
  query,
  status,
}: {
  query?: string;
  status?: string;
}) {
  return (
    <QueryFilterForm
      basePath="/admin/customers"
      values={{ q: query ?? "", status: status ?? "" }}
      fields={[
        {
          name: "q",
          label: "Search",
          kind: "search",
          placeholder: "Search name or email",
          className: "sm:col-span-2",
        },
        {
          name: "status",
          label: "Status",
          kind: "select",
          allLabel: "All statuses",
          options: [
            { value: "ACTIVE", label: "Active" },
            { value: "SUSPENDED", label: "Suspended" },
          ],
        },
      ]}
    />
  );
}
