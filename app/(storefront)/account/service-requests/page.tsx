import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/session";
import { listMyServiceRequests } from "@/src/modules/service-request/use-cases/list-my-service-requests";

export const instant = false;

export default async function MyServiceRequestsPage() {
  const actor = await getSessionUser();
  if (!actor) redirect("/login?next=/account/service-requests");
  const page = await listMyServiceRequests(actor, { limit: 50 });
  return (
    <main className="page-shell section-space">
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
      <div className="mt-8 grid gap-4">
        {page.items.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No service requests yet.
            </CardContent>
          </Card>
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
    </main>
  );
}
