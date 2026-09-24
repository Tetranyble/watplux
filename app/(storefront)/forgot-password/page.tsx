import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { ForgotPasswordForm } from "./forgot-password-form";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();
  return {
    title: copyValue(copy, "auth.forgot.metaTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function ForgotPasswordPage() {
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  return (
    <div className="page-shell flex flex-1 items-center py-12 sm:py-16">
      <section className="mx-auto w-full max-w-md rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          {c("auth.forgot.title")}
        </h1>
        <p className="mb-7 mt-2 text-sm leading-6 text-muted-foreground">
          {c("auth.forgot.description")}
        </p>
        <ForgotPasswordForm />
      </section>
    </div>
  );
}
