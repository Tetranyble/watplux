import type { Metadata } from "next";
import { ClipboardCheck, HardHat, ShieldCheck } from "lucide-react";
import { Suspense } from "react";

import { ServiceRequestForm } from "@/components/storefront/service-request-form";
import { Badge } from "@/components/ui/badge";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Solar installation",
  description:
    "Request professional solar installation, assessment and commissioning from Watplux.",
};

async function InstallationRequestForm() {
  const actor = await getSessionUser();
  return (
    <ServiceRequestForm
      serviceType="INSTALLATION"
      authenticated={Boolean(actor)}
    />
  );
}

export default function InstallationPage() {
  return (
    <div className="page-shell py-10 sm:py-12 lg:py-14">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] lg:gap-12 xl:gap-16">
        <section className="lg:sticky lg:top-24">
          <Badge variant="outline" className="mb-4">
            Installation service
          </Badge>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-4xl xl:text-5xl">
            Professional installation, from site check to commissioning.
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            Whether you bought the equipment from Watplux or already own it,
            submit the site details so the team can evaluate the work before
            scheduling.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {[
              [
                ClipboardCheck,
                "Assess",
                "Review equipment, site constraints and installation readiness.",
              ],
              [
                HardHat,
                "Install",
                "Plan a safe installation with clear responsibility and scope.",
              ],
              [
                ShieldCheck,
                "Commission",
                "Test the finished system before handover.",
              ],
            ].map(([Icon, title, copy]) => {
              const C = Icon as typeof ClipboardCheck;
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
                Loading installation form…
              </div>
            }
          >
            <InstallationRequestForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
