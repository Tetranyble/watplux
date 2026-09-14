/**
 * Structural RBAC seed data — roles and permissions, per
 * docs/ARCHITECTURE.md §11 and docs/PHASE_3_AUTH_RBAC_PLAN.md §12.3. This
 * is reference/structural data, not the "fake business data" Phase 2B
 * explicitly excluded (no products, customers, or orders are seeded here).
 *
 * The actual logic lives in prisma/seed-data.ts so it can be reused by the
 * integration test setup — this file is just the `prisma db seed` CLI entry
 * point.
 *
 * Also bootstraps a `super_admin` account from `SEED_ADMIN_EMAIL`/
 * `SEED_ADMIN_PASSWORD` (see .env.example) — see prisma/seed-admin.ts for
 * why this, and only this, piece of non-structural data belongs here: RBAC
 * seeding alone leaves no way to reach `/admin` at all. A no-op if those
 * env vars are unset.
 */
import { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";
import { seedAdminAccount } from "./seed-admin";
import { seedRbacData } from "./seed-data";

const db = new PrismaClient();

seedRbacData(db)
  .then(() =>
    seedAdminAccount(db, {
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      name: env.SEED_ADMIN_NAME,
    }),
  )
  .then(() => console.log("Seed complete."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
