import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionUser } from "@/lib/session";
import { listMyServiceRequests } from "@/src/modules/service-request/use-cases/list-my-service-requests";

export const instant = false;

export default async function MyServiceRequestsPage() {
  const actor = await getSessionUser();
  if (!actor) redirect("/login?next=/account/service-requests");
  const page = await listMyServiceRequests(actor, { limit: 50 });
  return (
    <div className="page-shell flex flex-1 flex-col py-10 sm:py-12 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge variant="outline" className="mb-3">
            Service requests
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            Consultation & installation
          </h1>
          <p className="mt-2 text-muted-foreground">
            Track requests submitted while signed in.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/consultation" />}
          >
            New consultation
          </Button>
          <Button nativeButton={false} render={<Link href="/installation" />}>
            Request installation
          </Button>
        </div>
      </div>
      <div className="mt-8 flex flex-1 flex-col gap-4">
        {page.items.length === 0 ? (
          <EmptyState
            className="min-h-80"
            icon={ClipboardList}
            title="No service requests yet"
            description="Tell us what you need and track every update here from submission through completion."
            action={
              <div className="flex w-full max-w-sm flex-col-reverse gap-2 sm:flex-row sm:justify-center">
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/consultation" />}
                >
                  New consultation
                </Button>
                <Button
                  nativeButton={false}
                  render={<Link href="/installation" />}
                >
                  Request installation
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
                      Request #{item.id} · {item.createdAt.toLocaleDateString()}
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
