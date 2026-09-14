import { expect, test } from "@playwright/test";

test("liveness does not depend on the database", async ({ request }) => {
  const response = await request.get("/api/live");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.service).toBe("watplux-web");
});

test("readiness confirms the app can serve database-backed traffic", async ({
  request,
}) => {
  const response = await request.get("/api/ready");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.database).toBe("connected");
});
