import { NextResponse } from "next/server";

import { getTrustedClientIp } from "@/lib/request-security";
import { consumeRateLimit } from "@/src/integrations/rate-limit/consume";

export async function enforcePublicRateLimit(
  request: Request,
  options: { namespace: string; windowSeconds: number; max: number },
): Promise<NextResponse | null> {
  const decision = await consumeRateLimit({
    ...options,
    identity: getTrustedClientIp(request),
  });
  if (decision.allowed) return null;

  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(decision.retryAfterSeconds),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}
