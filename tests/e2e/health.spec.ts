import { expect, test } from "@playwright/test";

test("GET /api/health reports a connected database against the real app + MySQL", async ({
  request,
}) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.database).toBe("connected");
});
