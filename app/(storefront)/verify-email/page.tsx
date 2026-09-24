import type { Metadata } from "next";
import { MailCheck } from "lucide-react";

import { ResendVerificationForm } from "./resend-verification-form";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();
  return {
    title: copyValue(copy, "auth.verify.metaTitle"),
    robots: { index: false, follow: false },
  };
}

// The message varies with the `sent` query parameter. This small auth route
// should render atomically rather than exposing a misleading static shell.
export const instant = false;

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  return (
    <div className="page-shell flex flex-1 items-center py-12 sm:py-16">
      <section className="mx-auto w-full max-w-md rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-lg bg-primary/15 text-primary-emphasis">
          <MailCheck className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          {c("auth.verify.title")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {sent
            ? c("auth.verify.sentDescription")
            : c("auth.verify.description")}
        </p>
        <div className="my-7 h-px bg-border" />
        <p className="mb-4 text-sm font-medium">{c("auth.verify.fresh")}</p>
        <ResendVerificationForm />
      </section>
    </div>
  );
}
