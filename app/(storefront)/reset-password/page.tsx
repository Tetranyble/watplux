import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { ResetPasswordForm } from "./reset-password-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

// The reset token and Better Auth error are request-specific and determine
// whether the password form may be shown at all.
export const instant = false;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const invalid = !token || Boolean(error);

  return (
    <div className="page-shell flex flex-1 items-center py-12 sm:py-16">
      <section className="mx-auto w-full max-w-md rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          {invalid ? "Reset link unavailable" : "Choose a new password"}
        </h1>
        {invalid ? (
          <>
            <p className="mb-7 mt-2 text-sm leading-6 text-muted-foreground">
              This password-reset link is invalid or has expired. Request a new
              link to continue.
            </p>
            <Button
              className="w-full"
              nativeButton={false}
              render={<Link href="/forgot-password" />}
            >
              Request another link
            </Button>
          </>
        ) : (
          <>
            <p className="mb-7 mt-2 text-sm leading-6 text-muted-foreground">
              Your new password will replace the old one and sign out existing
              sessions for your protection.
            </p>
            <ResetPasswordForm token={token} />
          </>
        )}
      </section>
    </div>
  );
}
