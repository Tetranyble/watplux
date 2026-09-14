"use client";
import { QueryFilterForm } from "@/components/forms/query-filter-form";

const ORDER_STATUS_OPTIONS = [
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "READY_FOR_DISPATCH",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;
export interface OrderFilterValues {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  orderNumber?: string;
  customerEmail?: string;
}
export function OrderFilterForm({ values }: { values: OrderFilterValues }) {
  return (
    <QueryFilterForm
      values={{
        status: values.status ?? "",
        orderNumber: values.orderNumber ?? "",
        customerEmail: values.customerEmail ?? "",
        dateFrom: values.dateFrom ?? "",
        dateTo: values.dateTo ?? "",
      }}
      fields={[
        {
          name: "orderNumber",
          label: "Order number",
          kind: "search",
          placeholder: "ORD-…",
        },
        {
          name: "customerEmail",
          label: "Customer email",
          kind: "email",
          placeholder: "name@example.com",
        },
        {
          name: "status",
          label: "Status",
          kind: "select",
          options: ORDER_STATUS_OPTIONS.map((status) => ({
            value: status,
            label: status.replaceAll("_", " "),
          })),
          allLabel: "All statuses",
        },
        { name: "dateFrom", label: "From", kind: "date" },
        { name: "dateTo", label: "To", kind: "date" },
      ]}
    />
  );
}
