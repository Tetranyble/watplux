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
    <main className="page-shell section-space">
      <div className="mx-auto max-w-4xl">
        <Badge variant="outline" className="mb-4">
          Installation service
        </Badge>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Professional installation, from site check to commissioning.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
          Whether you bought the equipment from Watplux or already own it,
          submit the site details so the team can evaluate the work before
          scheduling.
        </p>
        <div className="my-8 grid gap-4 sm:grid-cols-3">
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
              Loading installation form…
            </div>
          }
        >
          <InstallationRequestForm />
        </Suspense>
      </div>
    </main>
  );
}
