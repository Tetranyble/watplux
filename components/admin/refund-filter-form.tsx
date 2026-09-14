"use client";
import { QueryFilterForm } from "@/components/forms/query-filter-form";
const OPTIONS = [
  "REFUND_REQUESTED",
  "REFUND_PENDING",
  "REFUNDED",
  "REFUND_FAILED",
  "REFUND_CANCELLED",
] as const;
export function RefundFilterForm({ status }: { status?: string }) {
  return (
    <QueryFilterForm
      values={{ status: status ?? "" }}
      fields={[
        {
          name: "status",
          label: "Status",
          kind: "select",
          options: OPTIONS.map((value) => ({
            value,
            label: value.replaceAll("_", " "),
          })),
          allLabel: "All statuses",
        },
      ]}
    />
  );
}
