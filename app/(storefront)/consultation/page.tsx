import type { Metadata } from "next";
import { BatteryCharging, Calculator, SunMedium } from "lucide-react";
import { Suspense } from "react";

import { ServiceRequestForm } from "@/components/storefront/service-request-form";
import { Badge } from "@/components/ui/badge";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Solar consultation",
  description:
    "Request a solar consultation and give our team the information needed to size a practical system for your property.",
};

async function ConsultationRequestForm() {
  const actor = await getSessionUser();
  return (
    <ServiceRequestForm
      serviceType="CONSULTATION"
      authenticated={Boolean(actor)}
    />
  );
}

export default function ConsultationPage() {
  return (
    <div className="page-shell py-10 sm:py-12 lg:py-14">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] lg:gap-12 xl:gap-16">
        <section className="lg:sticky lg:top-24">
          <Badge variant="outline" className="mb-4">
            Solar advisory
          </Badge>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-4xl xl:text-5xl">
            Plan the right solar system before you spend.
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            Share your loads, backup expectations and site details. Our team
            will review the request and contact you with the next practical
            step.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {[
              [
                SunMedium,
                "Understand the site",
                "Tell us where and how you use power.",
              ],
              [
                Calculator,
                "Size the system",
                "We translate your needs into realistic capacity.",
              ],
              [
                BatteryCharging,
                "Plan for backup",
                "We align batteries and inverter capacity to your goals.",
              ],
            ].map(([Icon, title, copy]) => {
              const C = Icon as typeof SunMedium;
              return (
                <div key={String(title)} className="surface-card p-5">
                  <C
                    className="size-5 text-primary-emphasis"
                    aria-hidden="true"
                  />
                  <h2 className="mt-4 font-semibold">{String(title)}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {String(copy)}
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
                Loading consultation form…
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
