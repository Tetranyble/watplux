import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { ResetPasswordForm } from "./reset-password-form";
import { Button } from "@/components/ui/button";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();
  return {
    title: copyValue(copy, "auth.reset.metaTitle"),
    robots: { index: false, follow: false },
  };
}

// The reset token and Better Auth error are request-specific and determine
// whether the password form may be shown at all.
export const instant = false;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  const invalid = !token || Boolean(error);

  return (
    <div className="page-shell flex flex-1 items-center py-12 sm:py-16">
      <section className="mx-auto w-full max-w-md rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          {invalid ? c("auth.reset.invalidTitle") : c("auth.reset.title")}
        </h1>
        {invalid ? (
          <>
            <p className="mb-7 mt-2 text-sm leading-6 text-muted-foreground">
              {c("auth.reset.invalidDescription")}
            </p>
            <Button
              className="w-full"
              nativeButton={false}
              render={<Link href="/forgot-password" />}
            >
              {c("auth.reset.requestAgain")}
            </Button>
          </>
        ) : (
          <>
            <p className="mb-7 mt-2 text-sm leading-6 text-muted-foreground">
              {c("auth.reset.description")}
            </p>
            <ResetPasswordForm token={token} />
          </>
        )}
      </section>
    </div>
  );
}
