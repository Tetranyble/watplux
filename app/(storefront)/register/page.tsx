import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md items-center px-4 py-12">
      <section className="w-full rounded-3xl border bg-background p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-primary">Customer account</p>
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
