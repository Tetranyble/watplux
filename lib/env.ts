import { z } from "zod";

const emptyStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalNonEmptyString = z.preprocess(
  emptyStringToUndefined,
  z.string().min(1).optional(),
);
const optionalEmail = z.preprocess(
  emptyStringToUndefined,
  z.string().email().optional(),
);

/**
 * Typed, validated environment configuration.
 *
 * Fails fast at import time if a required variable is missing or malformed,
 * rather than surfacing as an obscure runtime error deep inside a use-case.
 * See docs/ARCHITECTURE.md — deployment (§15) and security (§17) note that
 * secrets must come from environment variables, never be hardcoded, and
 * never be logged.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Deployment identity is separate from NODE_ENV so staging can still run
  // optimized production code without pretending to be the live environment.
  DEPLOYMENT_ENV: z
    .enum(["local", "test", "build", "staging", "production"])
    .default("local"),
  APP_VERSION: z.string().min(1).default("0.1.0"),
  GIT_SHA: z.string().min(1).default("unknown"),

  // MySQL connection string for Prisma, e.g. mysql://user:pass@host:3306/db
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (value) => value.startsWith("mysql://"),
      "DATABASE_URL must be a mysql:// connection string",
    ),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // Better Auth — the single authentication/session owner. Keep this secret
  // server-only and rotate it deliberately; never expose it through NEXT_PUBLIC_*.
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
    .optional(),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Client IP is accepted only from one deployment-controlled proxy header.
  // The ingress MUST overwrite this header rather than trust a client value.
  TRUSTED_CLIENT_IP_HEADER: z
    .enum(["x-real-ip", "cf-connecting-ip", "x-forwarded-for"])
    .default("x-real-ip"),

  // Payment (Phase 8) — see docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §7/§21.
  // Deliberately optional here, not required-with-no-default like
  // DATABASE_URL: dev/test environments run against a fake Paystack
  // adapter (plan §28.4) and never actually need a real secret key to
  // boot. `src/integrations/paystack/client.ts` itself throws a clear,
  // specific error if a real call is ever attempted without one — env
  // loading failing at import time for every contributor who hasn't
  // configured Paystack yet would be a worse failure mode than a precise
  // error at the one call site that actually needs the key.
  PAYSTACK_SECRET_KEY: z.string().min(1).optional(),
  // Shared secret the internal webhook-worker trigger route
  // (app/api/internal/process-webhook-events/route.ts) requires on every
  // request — machine-to-machine only, never a user session (plan §16).
  // Optional for the same reason as above; the route itself fails closed
  // (rejects every request) if this is unset, rather than silently
  // allowing unauthenticated access.
  INTERNAL_WORKER_SECRET: z.string().min(32).optional(),
  // Webhook-event claim staleness — docs/ARCHITECTURE.md §6.3's own
  // already-decided 5-minute value (plan §14.2/§34 Q5).
  WEBHOOK_STALE_LOCK_MINUTES: z.coerce.number().int().positive().default(5),
  // Cap on processing_attempts before a webhook_events row is left
  // permanently FAILED rather than retried forever (plan §13.2/§34 Q4).
  WEBHOOK_MAX_PROCESSING_ATTEMPTS: z.coerce
    .number()
    .int()
    .positive()
    .default(10),

  // Guest payment-result access token (Phase 9) — docs/PHASE_9_STOREFRONT_PLAN.md
  // §13.4 Option A. Optional, same fail-closed discipline as
  // `PAYSTACK_SECRET_KEY`: if unset, no guest token is ever issued or
  // accepted (`generateGuestOrderToken`/`verifyGuestOrderToken` both
  // return null/false rather than falling back to an insecure default
  // secret) — guest checkout still works, it just falls back to the
  // no-live-status experience (plan §13.4 Option B) until this is set.
  GUEST_ORDER_TOKEN_SECRET: z.string().min(32).optional(),

  // Storefront (Phase 9) — docs/PHASE_9_STOREFRONT_PLAN.md §31. The
  // absolute origin Paystack's hosted checkout redirects back to after a
  // payment attempt (`/checkout/payment-result`); Paystack requires a
  // full, absolute URL, not a relative path, so this can't be derived
  // from the incoming request alone at the one call site that needs it
  // (`initialize-payment.ts`, framework-agnostic, no `next/headers`).
  // Defaults to localhost for dev/test, matching every other
  // Phase-8-style optional-with-a-safe-default var above — production
  // deployments must set this to the real public origin.
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  // Transactional email. Local/test environments default to a non-delivering
  // log transport; production readiness requires SMTP credentials.
  MAIL_MAILER: z.enum(["log", "smtp"]).default("log"),
  MAIL_HOST: optionalNonEmptyString,
  MAIL_PORT: z.coerce.number().int().positive().max(65535).default(587),
  MAIL_SCHEME: z.enum(["tls", "ssl", "none"]).default("tls"),
  MAIL_USERNAME: optionalNonEmptyString,
  MAIL_PASSWORD: optionalNonEmptyString,
  MAIL_FROM_ADDRESS: optionalEmail,
  MAIL_FROM_NAME: z.string().min(1).default("Watplux"),

  // Optional transactional SMS acknowledgement through Termii. The provider
  // is disabled unless the base URL, API key and sender ID are all configured.
  TERMII_BASE_URL: z.string().url().optional(),
  TERMII_API_KEY: z.string().min(1).optional(),
  TERMII_SENDER_ID: z.string().min(3).max(11).optional(),
  TERMII_CHANNEL: z.enum(["dnd", "generic"]).default("dnd"),
  TERMII_DEFAULT_COUNTRY_CODE: z
    .string()
    .regex(/^\d{1,4}$/)
    .default("234"),

  // Media / object storage (Phase 14). Local disk is the development default;
  // production should use an S3-compatible object store and public CDN/base URL.
  MEDIA_STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  MEDIA_UPLOAD_MAX_MB: z.coerce.number().int().positive().max(50).default(10),
  LOCAL_MEDIA_ROOT: z.string().min(1).default(".storage/media"),
  CPANEL_PERSISTENT_LOCAL_MEDIA: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),

  // Bootstrap admin account (Phase 10) — read only by `prisma/seed.ts`
  // (`prisma/seed-admin.ts`), never by the running app. Both optional and
  // unset by default: seeding creates zero business/user rows on its own
  // (structural RBAC data only, per the Phase 2B decision this project
  // has kept ever since), so the very first `super_admin` account has to
  // come from somewhere outside the app itself. Setting these two env
  // vars before running `npm run db:seed` creates (or promotes, if the
  // email already exists) that account with every permission, closing
  // the chicken-and-egg gap without a raw SQL insert. Left unset, seeding
  // skips this step entirely and logs why.
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(10).optional(),
  SEED_ADMIN_NAME: z.string().min(1).default("Admin"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    // logger itself depends on env, so this is the one place in the
    // codebase allowed to use console directly.
    console.error("❌ Invalid environment variables:", fieldErrors);
    throw new Error(
      "Invalid environment variables — see the field errors logged above.",
    );
  }

  return parsed.data;
}

export const env = loadEnv();

export function requireBetterAuthSecret(): string {
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET is required before authentication can be used.",
    );
  }
  return env.BETTER_AUTH_SECRET;
}
