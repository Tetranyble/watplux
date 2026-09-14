import { NextResponse } from "next/server";

import { checkHealth } from "@/src/modules/health/use-cases/check-health";

/**
 * GET /api/health
 *
 * Calls the health use-case only — never the repo/Prisma client directly.
 * The ESLint import-boundary rule (eslint.config.mjs) enforces this even
 * if someone tries to shortcut it later; see docs/ARCHITECTURE.md §21.
 */
export async function GET() {
  const report = await checkHealth();
  const httpStatus = report.status === "ok" ? 200 : 503;

  return NextResponse.json(report, { status: httpStatus });
}
