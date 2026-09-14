import { expect, test } from "@playwright/test";

test.describe("release: security and operational HTTP boundaries", () => {
  test("public responses carry the baseline browser security policy", async ({
    request,
  }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("Paystack webhook rejects oversized bodies before signature processing", async ({
    request,
  }) => {
    const oversized = "x".repeat(256 * 1024 + 1);
    const response = await request.post("/api/paystack/webhook", {
      data: oversized,
      headers: { "content-type": "text/plain" },
    });
    expect(response.status()).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Payload too large.",
    });
  });

  test("internal webhook worker remains machine-authenticated", async ({
    request,
  }) => {
    const noSecret = await request.get("/api/internal/process-webhook-events");
    expect([401, 503]).toContain(noSecret.status());

    const wrongSecret = await request.get(
      "/api/internal/process-webhook-events",
      {
        headers: { "x-internal-worker-secret": "not-the-secret" },
      },
    );
    expect([401, 503]).toContain(wrongSecret.status());
  });
});
