import { describe, expect, it } from "vitest";

import { checkHealth } from "@/src/modules/health/use-cases/check-health";

/**
 * The repo (real Prisma call) is injected, not imported — this test needs
 * no live database, per docs/ARCHITECTURE.md §16's dependency-injection
 * pattern for testing use-cases in isolation.
 */
describe("checkHealth", () => {
  it("reports ok when the database ping succeeds", async () => {
    const report = await checkHealth(async () => undefined);

    expect(report.status).toBe("ok");
    expect(report.database).toBe("connected");
    expect(new Date(report.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("reports degraded when the database ping fails, without throwing", async () => {
    const report = await checkHealth(async () => {
      throw new Error("connection refused");
    });

    expect(report.status).toBe("degraded");
    expect(report.database).toBe("error");
  });
});
