import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export const instant = false;

export default async function ServiceRequestSubmittedPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return (
    <div className="page-shell section-space">
      <div className="mx-auto max-w-xl surface-card p-8 text-center sm:p-10">
        <CheckCircle2
          className="mx-auto size-12 text-primary-emphasis"
          aria-hidden="true"
        />
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          Request received
        </h1>
        <p className="mt-3 leading-7 text-muted-foreground">
          Our team can now review the information you submitted and follow up
          with the next step.
          {id ? ` Your request reference is #${id}.` : ""}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button nativeButton={false} render={<Link href="/products" />}>
            Browse products
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/account/service-requests" />}
          >
            View my requests
          </Button>
        </div>
      </div>
    </div>
  );
}
