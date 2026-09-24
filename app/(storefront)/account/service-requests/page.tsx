import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionUser } from "@/lib/session";
import { listMyServiceRequests } from "@/src/modules/service-request/use-cases/list-my-service-requests";
import { copyValue, getSiteCopy, interpolateCopy } from "@/app/_data/site-copy";

export const instant = false;

export default async function MyServiceRequestsPage() {
  const [actor, copy] = await Promise.all([getSessionUser(), getSiteCopy()]);
  if (!actor) redirect("/login?next=/account/service-requests");
  const c = (key: string) => copyValue(copy, key);
  const page = await listMyServiceRequests(actor, { limit: 50 });
  return (
    <div className="page-shell flex flex-1 flex-col py-10 sm:py-12 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge variant="outline" className="mb-3">
            {c("account.requests.eyebrow")}
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            {c("account.requests.title")}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {c("account.requests.description")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/consultation" />}
          >
            {c("account.requests.consultation")}
          </Button>
          <Button nativeButton={false} render={<Link href="/installation" />}>
            {c("account.requests.installation")}
          </Button>
        </div>
      </div>
      <div className="mt-8 flex flex-1 flex-col gap-4">
        {page.items.length === 0 ? (
          <EmptyState
            className="min-h-80"
            icon={ClipboardList}
            title={c("account.requests.emptyTitle")}
            description={c("account.requests.emptyDescription")}
            action={
              <div className="flex w-full max-w-sm flex-col-reverse gap-2 sm:flex-row sm:justify-center">
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/consultation" />}
                >
                  {c("account.requests.consultation")}
                </Button>
                <Button
                  nativeButton={false}
                  render={<Link href="/installation" />}
                >
                  {c("account.requests.installation")}
                </Button>
              </div>
            }
          />
        ) : (
          page.items.map((item) => (
            <Link
              key={item.id}
              href={`/account/service-requests/${item.id}`}
              className="block"
            >
              <Card className="transition hover:border-primary/40 hover:shadow-sm">
                <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle className="text-lg">
                      {item.serviceType.replaceAll("_", " ")}
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {interpolateCopy(c("account.request.reference"), {
                        id: item.id,
                      })}{" "}
                      · {item.createdAt.toLocaleDateString()}
                    </p>
                  </div>
                  <Badge>{item.status.replaceAll("_", " ")}</Badge>
                </CardHeader>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
