import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { pingDatabase } from "@/src/modules/health/repo";

export type ReadinessReport = {
  status: "ok" | "degraded";
  database: "connected" | "error";
  configuration: "valid" | "error";
  issues: string[];
  timestamp: string;
};

export function productionConfigurationIssues(): string[] {
  if (env.DEPLOYMENT_ENV !== "production") return [];

  const issues: string[] = [];
  if (!env.BETTER_AUTH_SECRET)
    issues.push("BETTER_AUTH_SECRET is required in production.");
  if (!env.APP_BASE_URL.startsWith("https://"))
    issues.push("APP_BASE_URL must use HTTPS in production.");
  if (!env.BETTER_AUTH_URL.startsWith("https://"))
    issues.push("BETTER_AUTH_URL must use HTTPS in production.");
  if (!env.PAYSTACK_SECRET_KEY)
    issues.push("PAYSTACK_SECRET_KEY is required in production.");
  if (!env.INTERNAL_WORKER_SECRET)
    issues.push("INTERNAL_WORKER_SECRET is required in production.");
  if (!env.GUEST_ORDER_TOKEN_SECRET)
    issues.push("GUEST_ORDER_TOKEN_SECRET is required in production.");
  if (env.MEDIA_STORAGE_PROVIDER !== "s3")
    issues.push("Production media storage must use the S3 provider.");
  if (env.MEDIA_STORAGE_PROVIDER === "s3" && !env.S3_BUCKET)
    issues.push("S3_BUCKET is required for production media storage.");
  return issues;
}

export async function checkReadiness(
  ping: () => Promise<void> = pingDatabase,
): Promise<ReadinessReport> {
  const issues = productionConfigurationIssues();
  let database: ReadinessReport["database"] = "connected";

  try {
    await ping();
  } catch (error) {
    database = "error";
    logger.error({ err: error }, "Readiness check: database ping failed");
  }

  const configuration = issues.length === 0 ? "valid" : "error";
  return {
    status:
      database === "connected" && configuration === "valid" ? "ok" : "degraded",
    database,
    configuration,
    issues,
    timestamp: new Date().toISOString(),
  };
}
