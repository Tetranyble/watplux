"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    // No client-side logging pipeline yet (Observability phase, future work).
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-zinc-500">
            An unexpected error occurred. You can try again, or come back later.
          </p>
          <Button type="button" variant="outline" onClick={reset}>
            Try again
          </Button>
        </div>
      </body>
    </html>
  );
}
