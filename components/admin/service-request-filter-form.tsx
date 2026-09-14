"use client";

import { QueryFilterForm } from "@/components/forms/query-filter-form";

export function ServiceRequestFilterForm({
  status,
  serviceType,
}: {
  status?: string;
  serviceType?: string;
}) {
  return (
    <QueryFilterForm
      basePath="/admin/service-requests"
      values={{ status: status ?? "", serviceType: serviceType ?? "" }}
      fields={[
        {
          name: "status",
          label: "Status",
          kind: "select",
          allLabel: "All statuses",
          options: [
            "NEW",
            "CONTACTED",
            "SCHEDULED",
            "IN_PROGRESS",
            "COMPLETED",
            "CANCELLED",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        {
          name: "serviceType",
          label: "Service type",
          kind: "select",
          allLabel: "All service types",
          options: [
            "CONSULTATION",
            "SYSTEM_SIZING",
            "INSTALLATION",
            "MAINTENANCE",
            "SITE_ASSESSMENT",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
      ]}
    />
  );
}
