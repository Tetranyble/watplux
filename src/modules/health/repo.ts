import { db } from "@/lib/db";

/**
 * Data access layer — the only file in this module allowed to import the
 * Prisma client, per docs/ARCHITECTURE.md §1. `SELECT 1` needs no models,
 * which is why the Phase 1 schema (prisma/schema.prisma) can stay empty
 * and still prove real MySQL connectivity.
 */
export async function pingDatabase(): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
