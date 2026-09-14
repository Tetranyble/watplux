import { NextResponse } from "next/server";

import { env } from "@/lib/env";

/**
 * Process liveness only. Deliberately does not touch MySQL or external
 * services: an orchestrator should restart the process only when the process
 * itself is unhealthy, not because a dependency has a short outage.
 */
export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "watplux-web",
      version: env.APP_VERSION,
      revision: env.GIT_SHA,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
