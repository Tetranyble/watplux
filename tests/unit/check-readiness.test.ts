import { describe, expect, it } from "vitest";

import { checkReadiness } from "@/src/modules/health/use-cases/check-readiness";

describe("checkReadiness", () => {
  it("reports ready when configuration is valid and the database responds", async () => {
    const report = await checkReadiness(async () => undefined);

    expect(report.status).toBe("ok");
    expect(report.database).toBe("connected");
    expect(report.configuration).toBe("valid");
  });

  it("reports degraded instead of throwing when the database is unavailable", async () => {
    const report = await checkReadiness(async () => {
      throw new Error("database unavailable");
    });

    expect(report.status).toBe("degraded");
    expect(report.database).toBe("error");
  });
});
