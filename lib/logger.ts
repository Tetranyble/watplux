import pino from "pino";

import { env } from "@/lib/env";

/**
 * Structured logging foundation.
 *
 * - JSON output in production (machine-parseable, ready for log aggregation).
 * - Pretty, human-readable output in development.
 * - `redact` is a standing guard, not decoration: per docs/ARCHITECTURE.md §17,
 *   secrets, passwords, and full tokens must never be logged. Business code
 *   (Paystack integration, auth) is expected to log under these key names —
 *   this configuration ensures a mistake there doesn't leak a value.
 *
 * Server-only (pino uses Node.js APIs) — never import this from a Client
 * Component or an Edge runtime route.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "watplux-web",
    environment: env.DEPLOYMENT_ENV,
    version: env.APP_VERSION,
    revision: env.GIT_SHA,
    pid: process.pid,
  },
  redact: {
    paths: [
      "*.password",
      "*.passwordHash",
      "*.secret",
      "*.secretKey",
      "*.paystackSecretKey",
      "*.authorization",
      "*.token",
      "*.rawToken",
      "*.accessToken",
      "*.refreshToken",
      // pino's redact matches literal property names, not substrings — a
      // plain "*.token" pattern does NOT catch these auth-specific names
      // (docs/PHASE_3_AUTH_RBAC_PLAN.md §9.3). Listed explicitly rather than
      // relying on the generic patterns above to happen to cover them.
      "*.sessionToken",
      "*.sessionTokenHash",
      "*.tokenHash",
      "*.verificationToken",
      "*.resetToken",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
