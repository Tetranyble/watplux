import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ServiceRequestActions } from "@/components/admin/service-request-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/session";
import { getServiceRequestForAdmin } from "@/src/modules/service-request/use-cases/get-service-request-for-admin";

export const instant = false;

export default async function AdminServiceRequestDetail({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");
  const { requestId } = await params;
  let item;
  try {
    item = await getServiceRequestForAdmin(actor, BigInt(requestId));
  } catch {
    notFound();
  }
  return (
    <div>
      <Button
        variant="ghost"
        nativeButton={false}
        render={<Link href="/admin/service-requests" />}
      >
        ← Service requests
      </Button>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Request #{item.id}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {item.serviceType.replaceAll("_", " ")}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Submitted by {item.requesterName}
          </p>
        </div>
        <Badge>{item.status.replaceAll("_", " ")}</Badge>
      </div>
      <div className="mt-8 grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Assessment details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Detail label="Email" value={item.requesterEmail} />
            <Detail label="Phone" value={item.requesterPhone} />
            <Detail label="Property" value={item.propertyType} />
            <Detail label="Location" value={item.location} />
            <Detail
              label="Desired backup"
              value={
                item.desiredBackupHours
                  ? `${item.desiredBackupHours} hours`
                  : null
              }
            />
            <Detail label="Budget" value={item.budgetRange} />
            <Detail
              wide
              label="Current electricity"
              value={item.currentElectricitySituation}
            />
            <Detail wide label="Appliances / loads" value={item.appliances} />
            <Detail
              wide
              label="Existing equipment"
              value={item.existingEquipment}
            />
            <Detail
              wide
              label="Additional information"
              value={item.additionalInfo}
            />
          </CardContent>
        </Card>
        <div className="grid h-fit gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Workflow</CardTitle>
            </CardHeader>
            <CardContent>
              <ServiceRequestActions
                requestId={item.id}
                status={item.status}
                assignedTo={item.assignedTo}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {item.assigneeName
                ? `Assigned to ${item.assigneeName}.`
                : "Unassigned. Claim this request when you begin handling it."}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
function Detail({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string | null;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
        {value || "—"}
      </p>
    </div>
  );
}
