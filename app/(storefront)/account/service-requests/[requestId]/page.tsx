import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/session";
import { getServiceRequest } from "@/src/modules/service-request/use-cases/get-service-request";

export const instant = false;

export default async function ServiceRequestDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");
  const { requestId } = await params;
  let item;
  try {
    item = await getServiceRequest(actor, BigInt(requestId));
  } catch {
    notFound();
  }
  return (
    <main className="page-shell section-space">
      <Button
        variant="ghost"
        nativeButton={false}
        render={<Link href="/account/service-requests" />}
      >
        ← All requests
      </Button>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {item.serviceType.replaceAll("_", " ")}
          </h1>
          <p className="mt-2 text-muted-foreground">Request #{item.id}</p>
        </div>
        <Badge>{item.status.replaceAll("_", " ")}</Badge>
      </div>
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Request details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
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
            label="Current electricity"
            value={item.currentElectricitySituation}
            wide
          />
          <Detail label="Appliances" value={item.appliances} wide />
          <Detail
            label="Existing equipment"
            value={item.existingEquipment}
            wide
          />
          <Detail
            label="Additional information"
            value={item.additionalInfo}
            wide
          />
        </CardContent>
      </Card>
    </main>
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
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap">{value || "—"}</p>
    </div>
  );
}
