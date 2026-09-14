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
    <main className="page-shell section-space">
      <div className="mx-auto max-w-4xl">
        <Badge variant="outline" className="mb-4">
          Solar advisory
        </Badge>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Plan the right solar system before you spend.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
          Share your loads, backup expectations and site details. Our team will
          review the request and contact you with the next practical step.
        </p>

        <div className="my-8 grid gap-4 sm:grid-cols-3">
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
                <C className="size-5 text-primary" aria-hidden="true" />
                <h2 className="mt-4 font-semibold">{String(title)}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {String(copy)}
                </p>
              </div>
            );
          })}
        </div>

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
    </main>
  );
}
