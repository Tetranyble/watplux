import type { Metadata } from "next";
import { BatteryCharging, ShieldCheck, ShoppingBag } from "lucide-react";

import { LoginForm } from "@/app/(storefront)/login/login-form";

export const metadata: Metadata = { title: "Sign in" };
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="page-shell grid min-h-[calc(100vh-8rem)] items-center gap-10 py-12 lg:grid-cols-[1.1fr_.9fr]">
      <section className="hidden rounded-3xl border bg-muted/30 p-10 lg:block">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary-emphasis">
          Watplux Solar
        </p>
        <h2 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight">
          One account for products, payments and your solar orders.
        </h2>
        <div className="mt-10 grid gap-5 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <ShoppingBag className="mt-0.5 size-5 text-primary-emphasis" />
            <p>
              <strong className="text-foreground">Persistent cart.</strong> Pick
              up where you left off on any device.
            </p>
          </div>
          <div className="flex gap-3">
            <BatteryCharging className="mt-0.5 size-5 text-primary-emphasis" />
            <p>
              <strong className="text-foreground">Order visibility.</strong>{" "}
              Track every order and retry a pending payment safely.
            </p>
          </div>
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-primary-emphasis" />
            <p>
              <strong className="text-foreground">Secure access.</strong>{" "}
              Authentication and sessions are handled by Better Auth.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-md rounded-3xl border bg-background p-6 shadow-sm sm:p-8">
        <div className="mb-7">
          <p className="text-sm font-medium text-primary-emphasis">
            Welcome back
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage your cart, orders and payments.
          </p>
        </div>
        <LoginForm next={next} />
      </section>
    </div>
  );
}
