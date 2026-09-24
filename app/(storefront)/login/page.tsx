import type { Metadata } from "next";
import { BatteryCharging, ShieldCheck, ShoppingBag } from "lucide-react";

import { LoginForm } from "@/app/(storefront)/login/login-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();
  return {
    title: copyValue(copy, "auth.login.metaTitle"),
    robots: { index: false, follow: false },
  };
}
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; verified?: string }>;
}) {
  const { next, reset, verified } = await searchParams;
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);

  return (
    <div className="page-shell grid min-h-[calc(100vh-8rem)] items-center gap-10 py-12 lg:grid-cols-[1.1fr_.9fr]">
      <section className="hidden rounded-3xl border bg-muted/30 p-10 lg:block">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary-emphasis">
          {c("auth.login.brand")}
        </p>
        <h2 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight">
          {c("auth.login.pitch")}
        </h2>
        <div className="mt-10 grid gap-5 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <ShoppingBag className="mt-0.5 size-5 text-primary-emphasis" />
            <p>
              <strong className="text-foreground">
                {c("auth.login.cartTitle")}
              </strong>{" "}
              {c("auth.login.cartDescription")}
            </p>
          </div>
          <div className="flex gap-3">
            <BatteryCharging className="mt-0.5 size-5 text-primary-emphasis" />
            <p>
              <strong className="text-foreground">
                {c("auth.login.ordersTitle")}
              </strong>{" "}
              {c("auth.login.ordersDescription")}
            </p>
          </div>
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-primary-emphasis" />
            <p>
              <strong className="text-foreground">
                {c("auth.login.securityTitle")}
              </strong>{" "}
              {c("auth.login.securityDescription")}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-md rounded-3xl border bg-background p-6 shadow-sm sm:p-8">
        <div className="mb-7">
          <p className="text-sm font-medium text-primary-emphasis">
            {c("auth.login.welcome")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {c("auth.login.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {c("auth.login.description")}
          </p>
        </div>
        {verified || reset ? (
          <Alert className="mb-5 border-primary/30 bg-primary/10 px-3 py-3">
            <AlertTitle>
              {verified
                ? c("auth.login.verifiedTitle")
                : c("auth.login.resetTitle")}
            </AlertTitle>
            <AlertDescription>
              {verified
                ? c("auth.login.verifiedDescription")
                : c("auth.login.resetDescription")}
            </AlertDescription>
          </Alert>
        ) : null}
        <LoginForm next={next} />
      </section>
    </div>
  );
}
