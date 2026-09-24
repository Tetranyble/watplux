import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/session";
import { getServiceRequest } from "@/src/modules/service-request/use-cases/get-service-request";
import { copyValue, getSiteCopy, interpolateCopy } from "@/app/_data/site-copy";

export const instant = false;

export default async function ServiceRequestDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const [actor, copy] = await Promise.all([getSessionUser(), getSiteCopy()]);
  if (!actor) redirect("/login");
  const c = (key: string) => copyValue(copy, key);
  const { requestId } = await params;
  let item;
  try {
    item = await getServiceRequest(actor, BigInt(requestId));
  } catch {
    notFound();
  }
  return (
    <div className="page-shell section-space">
      <Button
        variant="ghost"
        nativeButton={false}
        render={<Link href="/account/service-requests" />}
      >
        {c("account.request.all")}
      </Button>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {item.serviceType.replaceAll("_", " ")}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {interpolateCopy(c("account.request.reference"), { id: item.id })}
          </p>
        </div>
        <Badge>{item.status.replaceAll("_", " ")}</Badge>
      </div>
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>{c("account.request.details")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Detail
            label={c("account.request.property")}
            value={item.propertyType}
          />
          <Detail label={c("account.request.location")} value={item.location} />
          <Detail
            label={c("account.request.backup")}
            value={
              item.desiredBackupHours
                ? interpolateCopy(c("account.request.hours"), {
                    hours: item.desiredBackupHours,
                  })
                : null
            }
          />
          <Detail
            label={c("account.request.budget")}
            value={item.budgetRange}
          />
          <Detail
            label={c("account.request.electricity")}
            value={item.currentElectricitySituation}
            wide
          />
          <Detail
            label={c("account.request.appliances")}
            value={item.appliances}
            wide
          />
          <Detail
            label={c("account.request.equipment")}
            value={item.existingEquipment}
            wide
          />
          <Detail
            label={c("account.request.additional")}
            value={item.additionalInfo}
            wide
          />
        </CardContent>
      </Card>
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
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap">{value || "—"}</p>
    </div>
  );
}
