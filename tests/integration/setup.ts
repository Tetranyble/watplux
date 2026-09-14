import { config } from "dotenv";

// Loads the real .env (real DATABASE_URL) for integration tests — unlike
// vitest.config.mts's unit-test setup, which overrides DATABASE_URL to a
// fake value since unit tests never touch a real connection. Integration
// tests deliberately exercise the real MySQL database
// (docs/PHASE_3_AUTH_RBAC_PLAN.md §12.1).
config();

// Guarantee RBAC seed data exists regardless of whether `npm run db:seed`
// was run manually first — idempotent, so safe even if it already has been.
const { db } = await import("@/lib/db");
const { seedRbacData } = await import("../../prisma/seed-data");
await seedRbacData(db);
