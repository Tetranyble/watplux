import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

import { seedRbacData } from "../../prisma/seed-data";

/**
 * Makes the browser/API release suite independently runnable. We seed only
 * structural RBAC reference data; no catalog/customer fixtures are created.
 */
export default async function globalSetup(): Promise<void> {
  config();
  const db = new PrismaClient();
  try {
    await seedRbacData(db);
  } finally {
    await db.$disconnect();
  }
}
