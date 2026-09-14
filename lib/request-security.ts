import { createHash, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

/**
 * Returns the client address only from the single header the deployment is
 * configured to trust. The reverse proxy must overwrite (not append) this
 * header before forwarding traffic to Watplux.
 */
export function getTrustedClientIp(request: Request): string {
  const raw = request.headers.get(env.TRUSTED_CLIENT_IP_HEADER)?.trim();
  if (!raw) return "unknown";

  return raw.split(",")[0]?.trim().slice(0, 64) || "unknown";
}

export function hashRateLimitIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time comparison for machine-to-machine shared secrets. */
export function safeEqualSecret(
  provided: string | null,
  expected: string,
): boolean {
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/** Allows only same-origin application paths for post-auth redirects. */
export function safeInternalPath(
  value: unknown,
  fallback = "/account",
): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return fallback;
  }
  try {
    const decoded = decodeURIComponent(value);
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      decoded.includes("\\")
    ) {
      return fallback;
    }
  } catch {
    return fallback;
  }
  return value;
}
