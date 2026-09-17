import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Create account",
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return (
    <div className="page-shell flex min-h-[calc(100vh-8rem)] items-center py-12">
      <section className="mx-auto w-full max-w-md rounded-3xl border bg-background p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-primary-emphasis">
          Customer account
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Create your account
        </h1>
        <p className="mb-7 mt-2 text-sm text-muted-foreground">
          Save your cart, track orders and manage payments from one place.
        </p>
        <RegisterForm />
      </section>
    </div>
  );
}
