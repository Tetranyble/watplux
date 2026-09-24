import type { Metadata } from "next";
import { BatteryCharging, Calculator, SunMedium } from "lucide-react";
import { Suspense } from "react";

import { ServiceRequestForm } from "@/components/storefront/service-request-form";
import { Badge } from "@/components/ui/badge";
import { getSessionUser } from "@/lib/session";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();
  return {
    title: copyValue(copy, "services.consultation.metaTitle"),
    description: copyValue(copy, "services.consultation.metaDescription"),
  };
}

async function ConsultationRequestForm() {
  const actor = await getSessionUser();
  return (
    <ServiceRequestForm
      serviceType="CONSULTATION"
      authenticated={Boolean(actor)}
    />
  );
}

export default async function ConsultationPage() {
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  const steps = [
    [
      SunMedium,
      c("services.consultation.step1.title"),
      c("services.consultation.step1.description"),
    ],
    [
      Calculator,
      c("services.consultation.step2.title"),
      c("services.consultation.step2.description"),
    ],
    [
      BatteryCharging,
      c("services.consultation.step3.title"),
      c("services.consultation.step3.description"),
    ],
  ];
  return (
    <div className="page-shell py-10 sm:py-12 lg:py-14">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] lg:gap-12 xl:gap-16">
        <section className="lg:sticky lg:top-24">
          <Badge variant="outline" className="mb-4">
            {c("services.consultation.badge")}
          </Badge>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-4xl xl:text-5xl">
            {c("services.consultation.title")}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            {c("services.consultation.description")}
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {steps.map(([Icon, title, description]) => {
              const C = Icon as typeof SunMedium;
              return (
                <div key={String(title)} className="surface-card p-5">
                  <C
                    className="size-5 text-primary-emphasis"
                    aria-hidden="true"
                  />
                  <h2 className="mt-4 font-semibold">{String(title)}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {String(description)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <div className="min-w-0">
          <Suspense
            fallback={
              <div className="surface-card p-8 text-sm text-muted-foreground">
                {c("services.consultation.loading")}
              </div>
            }
          >
            <ConsultationRequestForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
