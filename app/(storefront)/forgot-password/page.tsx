import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <div className="page-shell flex flex-1 items-center py-12 sm:py-16">
      <section className="mx-auto w-full max-w-md rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          Reset your password
        </h1>
        <p className="mb-7 mt-2 text-sm leading-6 text-muted-foreground">
          Enter your account email and we’ll send a secure reset link if the
          address is registered.
        </p>
        <ForgotPasswordForm />
      </section>
    </div>
  );
}
