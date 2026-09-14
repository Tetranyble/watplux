import { logger } from "@/lib/logger";
import { pingDatabase } from "@/src/modules/health/repo";
import type { HealthReport } from "@/src/modules/health/types";

/**
 * Application layer — orchestrates the repo call and shapes the result.
 * Accepts an injectable `ping` function (defaulting to the real repo) so
 * unit tests can exercise both the healthy and unhealthy branches without
 * a live database, per docs/ARCHITECTURE.md §16.
 */
export async function checkHealth(
  ping: () => Promise<void> = pingDatabase,
): Promise<HealthReport> {
  try {
    await ping();
    return {
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error({ err: error }, "Health check: database ping failed");
    return {
      status: "degraded",
      database: "error",
      timestamp: new Date().toISOString(),
    };
  }
}
