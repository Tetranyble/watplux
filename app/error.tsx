"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary (App Router file convention).
 *
 * Foundation only: logs client-side and shows a generic recovery UI.
 * Routing this into a real error-tracking service (Sentry or similar) is
 * an Observability-phase concern, not Phase 1 — see docs/ARCHITECTURE.md.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copy, setCopy] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    // No client-side logging pipeline yet (Observability phase, future work).
    console.error(error);
    void fetch("/api/site-copy/system")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setCopy(body?.copy ?? null))
      .catch(() => undefined);
  }, [error]);

  if (!copy) return null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">{copy["system.error.title"]}</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        {copy["system.error.description"]}
      </p>
      <Button type="button" variant="outline" onClick={reset}>
        {copy["system.error.retry"]}
      </Button>
    </div>
  );
}
