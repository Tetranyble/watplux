import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import {
  ArrowRight,
  BatteryCharging,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Truck,
  Wrench,
} from "lucide-react";

import {
  getCachedCategoryTree,
  getCachedProductListing,
} from "@/app/_data/catalog";
import { ProductGrid } from "@/components/storefront/product-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/lib/env";
import { consultationCtaHref, installationCtaHref } from "@/lib/site-config";

export const metadata: Metadata = {
  alternates: { canonical: env.APP_BASE_URL },
};

const TRUST_SIGNALS = [
  { icon: ShieldCheck, label: "Quality-checked equipment" },
  { icon: Truck, label: "Delivery support" },
  { icon: Wrench, label: "Professional installation" },
  { icon: BatteryCharging, label: "Solar-ready components" },
];

async function FeaturedProducts() {
  const page = await getCachedProductListing({ limit: 8, featured: true });
  if (page.items.length === 0) return null;

  return (
    <section className="page-shell section-space">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Featured equipment</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
            Built for dependable power
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Shop the equipment customers are choosing for homes, businesses, and
            backup-energy projects.
          </p>
        </div>
        <Button
          variant="ghost"
          nativeButton={false}
          render={<Link href="/products" />}
          className="hidden sm:inline-flex"
        >
          View all <ArrowRight className="size-4" />
        </Button>
      </div>
      <ProductGrid products={page.items} />
    </section>
  );
}

async function CategoryTeasers() {
  const categories = await getCachedCategoryTree();
  const topLevel = categories.slice(0, 6);
  if (topLevel.length === 0) return null;

  return (
    <section className="border-y bg-card/65">
      <div className="page-shell section-space">
        <div className="mb-8">
          <p className="eyebrow">Browse quickly</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
            Shop by category
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {topLevel.map((category, index) => (
            <Link
              key={category.id}
              href={`/categories/${category.slug}`}
              className="group flex items-center justify-between rounded-2xl border bg-background p-5 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
            >
              <div>
                <span className="text-xs font-semibold text-muted-foreground">
                  0{index + 1}
                </span>
                <p className="mt-1 font-semibold">{category.name}</p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary-emphasis" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_85%_15%,color-mix(in_srgb,var(--brand-sun)_22%,transparent),transparent_30%),radial-gradient(circle_at_10%_10%,color-mix(in_srgb,var(--primary)_14%,transparent),transparent_32%)]" />
        <div className="page-shell grid min-h-[620px] items-center gap-12 py-16 lg:grid-cols-[1.05fr_.95fr] lg:py-24">
          <div className="max-w-3xl">
            <Badge
              variant="outline"
              className="h-auto gap-2 bg-background/80 px-3 py-1.5 font-semibold text-muted-foreground shadow-sm backdrop-blur"
            >
              <Sparkles className="size-3.5 text-brand-sun" />
              Practical solar for real homes and businesses
            </Badge>
            <h1 className="mt-6 text-4xl font-black tracking-[-0.04em] sm:text-5xl lg:text-6xl">
              Reliable energy starts with the right system.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Shop solar equipment with confidence, or get help choosing and
              installing a system that fits your actual load and budget.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                size="lg"
                nativeButton={false}
                render={<Link href="/products" />}
              >
                Shop solar products <ArrowRight className="size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<Link href={consultationCtaHref} />}
              >
                Talk to an expert
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {[
                "Transparent product details",
                "Secure Paystack checkout",
                "Support before and after purchase",
              ].map((item) => (
                <span key={item} className="inline-flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary-emphasis" />{" "}
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl">
            <div className="surface-card relative overflow-hidden p-7 sm:p-9">
              <div className="absolute right-0 top-0 size-36 rounded-bl-[5rem] bg-brand-sun/18" />
              <div className="relative">
                <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                  <SunMedium className="size-7" />
                </div>
                <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  A better buying flow
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight">
                  Product → guidance → installation
                </h2>
                <div className="mt-7 grid gap-3">
                  {[
                    [
                      "01",
                      "Browse equipment",
                      "Compare useful product and solar-specific specifications.",
                    ],
                    [
                      "02",
                      "Get expert guidance",
                      "Ask for help before you commit to the wrong system size.",
                    ],
                    [
                      "03",
                      "Install with confidence",
                      "Move from purchase to professional installation support.",
                    ],
                  ].map(([number, title, copy]) => (
                    <div
                      key={number}
                      className="grid grid-cols-[auto_1fr] gap-4 rounded-xl bg-muted/60 p-4"
                    >
                      <span className="font-mono text-xs font-bold text-primary-emphasis">
                        {number}
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{title}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {copy}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-shell py-7">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          {TRUST_SIGNALS.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-3 text-sm">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary-emphasis">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="font-medium">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <Suspense fallback={<FeaturedProductsSkeleton />}>
        <FeaturedProducts />
      </Suspense>

      <Suspense fallback={null}>
        <CategoryTeasers />
      </Suspense>

      <section className="page-shell section-space">
        <div className="grid overflow-hidden rounded-3xl border bg-brand-ink text-white lg:grid-cols-2">
          <div className="p-7 sm:p-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-sun">
              Need help choosing?
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Size the system before you spend.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">
              Tell us what you need to power and we will help you narrow down
              the right equipment and capacity.
            </p>
            <Button
              className="mt-6 bg-brand-sun text-brand-sun-foreground hover:bg-brand-sun/90"
              nativeButton={false}
              render={<Link href={consultationCtaHref} />}
            >
              Book a consultation
            </Button>
          </div>
          <div className="border-t border-white/10 p-7 sm:p-10 lg:border-l lg:border-t-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-sun">
              Already purchased?
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Complete it with professional installation.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">
              Get installation support for panels, inverters, batteries, and
              complete solar systems.
            </p>
            <Button
              className="mt-6"
              variant="secondary"
              nativeButton={false}
              render={<Link href={installationCtaHref} />}
            >
              Request installation
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

function FeaturedProductsSkeleton() {
  return (
    <section className="page-shell section-space">
      <Skeleton className="mb-3 h-4 w-28" />
      <Skeleton className="mb-8 h-8 w-64" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />
        ))}
      </div>
    </section>
  );
}
