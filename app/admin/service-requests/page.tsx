import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, SearchX } from "lucide-react";

import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { ServiceRequestFilterForm } from "@/components/admin/service-request-filter-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/session";
import { listServiceRequestsSchema } from "@/src/modules/service-request/schema";
import { listServiceRequestsForAdmin } from "@/src/modules/service-request/use-cases/list-service-requests-for-admin";

export const instant = false;

export default async function AdminServiceRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login?next=/admin/service-requests");
  const input = listServiceRequestsSchema.parse(await searchParams);
  const page = await listServiceRequestsForAdmin(actor, input);
  const hasFilters = Boolean(input.status || input.serviceType);
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Customer services</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Consultation & installation requests
          </h1>
          <p className="mt-2 text-muted-foreground">
            Triage incoming requests and move them through a deliberate service
            workflow.
          </p>
        </div>
      </div>
      <div className="mt-6">
        <ServiceRequestFilterForm
          status={input.status}
          serviceType={input.serviceType}
        />
      </div>
      <div className="mt-6 flex flex-1 flex-col gap-3">
        {page.items.length === 0 ? (
          <AdminEmptyState
            icon={hasFilters ? SearchX : ClipboardList}
            title={
              hasFilters
                ? "No matching service requests"
                : "No service requests yet"
            }
            description={
              hasFilters
                ? "Adjust or clear the filters to see more requests."
                : "Consultation and installation requests will appear here when customers submit them."
            }
            action={
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    href={
                      hasFilters ? "/admin/service-requests" : "/consultation"
                    }
                  />
                }
              >
                {hasFilters ? "Clear filters" : "View service form"}
              </Button>
            }
          />
        ) : (
          page.items.map((item) => (
            <Link key={item.id} href={`/admin/service-requests/${item.id}`}>
              <Card className="transition hover:border-primary/40">
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle className="text-base">
                      {item.requesterName}
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.serviceType.replaceAll("_", " ")} ·{" "}
                      {item.location || "Location not supplied"} · #{item.id}
                    </p>
                  </div>
                  <Badge>{item.status.replaceAll("_", " ")}</Badge>
                </CardHeader>
              </Card>
            </Link>
          ))
        )}
      </div>
      {page.nextCursor ? (
        <div className="mt-6">
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link
                href={{
                  pathname: "/admin/service-requests",
                  query: {
                    ...(input.status ? { status: input.status } : {}),
                    ...(input.serviceType
                      ? { serviceType: input.serviceType }
                      : {}),
                    cursor: page.nextCursor,
                  },
                }}
              />
            }
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
