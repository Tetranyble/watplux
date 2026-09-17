import type { Metadata } from "next";
import { MailCheck } from "lucide-react";

import { ResendVerificationForm } from "./resend-verification-form";

export const metadata: Metadata = {
  title: "Verify your email",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <div className="page-shell flex flex-1 items-center py-12 sm:py-16">
      <section className="mx-auto w-full max-w-md rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-lg bg-primary/15 text-primary-emphasis">
          <MailCheck className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {sent
            ? "Your account was created. Use the verification link we sent before signing in."
            : "Use the verification link in your inbox to activate your account."}
        </p>
        <div className="my-7 h-px bg-border" />
        <p className="mb-4 text-sm font-medium">Need a fresh link?</p>
        <ResendVerificationForm />
      </section>
    </div>
  );
}
