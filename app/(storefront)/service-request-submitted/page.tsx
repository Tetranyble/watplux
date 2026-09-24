import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { copyValue, getSiteCopy, interpolateCopy } from "@/app/_data/site-copy";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();
  return {
    title: copyValue(copy, "services.submitted.metaTitle"),
    robots: { index: false, follow: false },
  };
}

export const instant = false;

export default async function ServiceRequestSubmittedPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  return (
    <div className="page-shell section-space">
      <div className="mx-auto max-w-xl surface-card p-8 text-center sm:p-10">
        <CheckCircle2
          className="mx-auto size-12 text-primary-emphasis"
          aria-hidden="true"
        />
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          {c("services.submitted.title")}
        </h1>
        <p className="mt-3 leading-7 text-muted-foreground">
          {c("services.submitted.description")}
          {id
            ? ` ${interpolateCopy(c("services.submitted.reference"), { id })}`
            : ""}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button nativeButton={false} render={<Link href="/products" />}>
            {c("services.submitted.products")}
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/account/service-requests" />}
          >
            {c("services.submitted.requests")}
          </Button>
        </div>
      </div>
    </div>
  );
}
