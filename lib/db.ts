import { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";

/**
 * Prisma client singleton.
 *
 * In development, Next.js hot-reloads server modules on every edit; without
 * caching the instance on `globalThis`, each reload would open a fresh
 * MySQL connection pool and eventually exhaust connections. The global is
 * skipped in production, where each server instance legitimately gets one
 * client for its lifetime.
 *
 * This is infrastructure only — no business schema lives here yet. Per
 * Phase 1 scope (docs/ARCHITECTURE.md §21), `prisma/schema.prisma` has no
 * models beyond what's needed to prove MySQL connectivity.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
