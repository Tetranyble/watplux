import { NextResponse } from "next/server";

import { checkReadiness } from "@/src/modules/health/use-cases/check-readiness";

/**
 * Traffic readiness. This may return 503 while the process remains alive.
 * Load balancers should stop routing new requests; they should not use this
 * endpoint as the container liveness probe. Detailed configuration issues are
 * intentionally not exposed on this unauthenticated operational endpoint.
 */
export async function GET() {
  const report = await checkReadiness();
  return NextResponse.json(
    {
      status: report.status,
      database: report.database,
      configuration: report.configuration,
      timestamp: report.timestamp,
    },
    {
      status: report.status === "ok" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
