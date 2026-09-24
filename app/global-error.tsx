"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Catches errors thrown by the root layout itself, which `error.tsx` cannot
 * (it renders inside the layout it would need to replace). Must render its
 * own <html>/<body> per the Next.js file convention.
 */
export default function GlobalError({
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

  if (!copy)
    return (
      <html lang="en">
        <body />
      </html>
    );

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-2xl font-semibold">
            {copy["system.error.title"]}
          </h1>
          <p className="max-w-md text-sm text-zinc-500">
            {copy["system.error.description"]}
          </p>
          <Button type="button" variant="outline" onClick={reset}>
            {copy["system.error.retry"]}
          </Button>
        </div>
      </body>
    </html>
  );
}
