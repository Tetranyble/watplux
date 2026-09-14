import { expect, request as playwrightRequest, test } from "@playwright/test";

/**
 * Exercises the actual application boundary end-to-end — real HTTP
 * requests against the built app, real MySQL database — per
 * docs/PHASE_3_AUTH_RBAC_PLAN.md §12/§27 ("at least some tests must
 * execute the actual application boundary: request -> session ->
 * authentication -> authorization -> use-case"). Deep RBAC/IDOR logic
 * variations are already covered at the integration level
 * (tests/integration/) against the same real database; these tests focus
 * on what's specific to the HTTP layer: cookies actually being set/
 * cleared, proxy.ts actually redirecting, and request-body tampering
 * actually being ignored.
 *
 * Uses Playwright's `request` fixture only (no browser binary needed) —
 * same pattern as tests/e2e/health.spec.ts.
 */

function uniqueEmail(label: string): string {
  return `phase3-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

const PASSWORD = "Sup3rSecretPassword";

// Matches playwright.config.ts's `use.baseURL`. Isolated multi-identity
// tests below need their own APIRequestContext (own cookie jar) rather than
// the shared `request` fixture, but `request.newContext()` — unlike the
// `browser` fixture — is a pure HTTP client and does NOT require a browser
// binary, preserving Phase 1's "no browser install needed" decision
// (tests/e2e/health.spec.ts / playwright.config.ts).
const BASE_URL = "http://localhost:3000";

test.describe("Better Auth registration + session lifecycle", () => {
  test("sign up -> session -> sign out -> sign in", async ({ request }) => {
    const email = uniqueEmail("lifecycle");

    const registerRes = await request.post("/api/auth/sign-up/email", {
      data: { email, password: PASSWORD, name: "E2E User" },
    });
    expect(registerRes.status()).toBe(200);
    expect(
      registerRes
        .headersArray()
        .some((h) => h.name.toLowerCase() === "set-cookie"),
    ).toBe(true);

    const sessionAfterSignup = await request.get("/api/auth/get-session");
    const signupBody = await sessionAfterSignup.json();
    expect(signupBody.user.email).toBe(email);
    expect(JSON.stringify(signupBody)).not.toContain("password");

    const logoutRes = await request.post("/api/auth/sign-out");
    expect(logoutRes.status()).toBe(200);
    const afterLogout = await request.get("/api/auth/get-session");
    const loggedOutSession = await afterLogout.json();
    expect(loggedOutSession?.user ?? null).toBeNull();

    const loginRes = await request.post("/api/auth/sign-in/email", {
      data: { email, password: PASSWORD },
    });
    expect(loginRes.status()).toBe(200);
    const setCookie = loginRes
      .headersArray()
      .find((h) => h.name.toLowerCase() === "set-cookie");
    expect(setCookie?.value).toContain("HttpOnly");

    const meAfterLogin = await request.get("/api/auth/get-session");
    expect((await meAfterLogin.json()).user.email).toBe(email);
  });

  test("duplicate sign-up is rejected without creating another account", async ({
    request,
  }) => {
    const email = uniqueEmail("dup");
    const first = await request.post("/api/auth/sign-up/email", {
      data: { email, password: PASSWORD, name: "First" },
    });
    expect(first.status()).toBe(200);
    await request.post("/api/auth/sign-out");

    const second = await request.post("/api/auth/sign-up/email", {
      data: { email, password: "SomeOtherPassw0rd", name: "Second" },
    });
    expect(second.status()).toBe(422);
  });

  test("wrong password and nonexistent account both fail without a session cookie", async ({
    request,
  }) => {
    const email = uniqueEmail("wrongpw");
    await request.post("/api/auth/sign-up/email", {
      data: { email, password: PASSWORD, name: "User" },
    });
    await request.post("/api/auth/sign-out");

    const wrongPassword = await request.post("/api/auth/sign-in/email", {
      data: { email, password: "TotallyWrongPassword" },
    });
    expect(wrongPassword.status()).toBe(401);
    expect(
      wrongPassword
        .headersArray()
        .some((h) => h.name.toLowerCase() === "set-cookie"),
    ).toBe(false);

    const missing = await request.post("/api/auth/sign-in/email", {
      data: {
        email: uniqueEmail("nonexistent"),
        password: "Whatever123Password",
      },
    });
    expect(missing.status()).toBe(401);
    expect((await missing.json()).message).toBe(
      (await wrongPassword.json()).message,
    );
  });
});

test.describe("proxy.ts route protection", () => {
  test("visiting /account without a session cookie redirects to /login", async ({
    request,
  }) => {
    const res = await request.get("/account", { maxRedirects: 0 });
    expect([307, 308, 302, 303]).toContain(res.status());
    const location = res.headers()["location"];
    expect(location).toContain("/login");
  });

  test("visiting /account with a valid session cookie is allowed through", async ({
    request,
  }) => {
    const email = uniqueEmail("account-access");
    await request.post("/api/auth/sign-up/email", {
      data: { email, password: PASSWORD, name: "Account User" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email, password: PASSWORD },
    });

    const res = await request.get("/account", { maxRedirects: 0 });
    // Not redirected — proxy.ts let it through (the page itself renders,
    // status 200). The real security check already happened once above at
    // login; this just confirms proxy.ts's cookie-presence check doesn't
    // incorrectly block a legitimately authenticated request.
    expect(res.status()).toBe(200);
  });
});

test.describe("IDOR and privilege escalation over real HTTP", () => {
  async function registerLoginAndGetId(
    request: import("@playwright/test").APIRequestContext,
    label: string,
  ) {
    const email = uniqueEmail(label);
    await request.post("/api/auth/sign-up/email", {
      data: { email, password: PASSWORD, name: label },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email, password: PASSWORD },
    });
    const me = await (await request.get("/api/auth/get-session")).json();
    return { email, id: me.user.id as string };
  }

  test("User A cannot fetch User B's profile via a manipulated ID in the URL", async () => {
    // Two independent cookie jars are required here — the shared `request`
    // fixture has one cookie jar per test, which would make "log in as A,
    // then as B" overwrite A's cookie. Two separate APIRequestContexts give
    // each user its own jar, exactly modeling two different real clients.
    const contextA = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const contextB = await playwrightRequest.newContext({ baseURL: BASE_URL });

    const { id: idB } = await registerLoginAndGetId(contextA, "idor-b-setup");
    // (Registering under contextB's own jar so A and B are genuinely
    // different authenticated identities.)
    await registerLoginAndGetId(contextB, "idor-a-setup");

    const resAtoB = await contextB.get(`/api/users/${idB}`);
    expect(resAtoB.status()).toBe(404);

    await contextA.dispose();
    await contextB.dispose();
  });

  test("a customer cannot assign themselves a staff role, even with extra forged fields in the request body", async ({
    request,
  }) => {
    const { id } = await registerLoginAndGetId(request, "escalate-self");

    const res = await request.post(`/api/admin/users/${id}/roles`, {
      data: {
        roleName: "staff",
        // Forged fields a naive implementation might mistakenly trust —
        // the real actor is ALWAYS resolved server-side from the session
        // cookie (requireSessionUser()), never from the request body.
        actorPermissions: ["users.manage"],
        isAdmin: true,
      },
    });
    expect(res.status()).toBe(403);
  });

  test("a customer cannot assign a role to a different user via a forged userId in the URL", async () => {
    const contextAttacker = await playwrightRequest.newContext({
      baseURL: BASE_URL,
    });
    const contextVictim = await playwrightRequest.newContext({
      baseURL: BASE_URL,
    });

    await registerLoginAndGetId(contextAttacker, "escalate-attacker");
    const { id: victimId } = await registerLoginAndGetId(
      contextVictim,
      "escalate-victim",
    );

    const res = await contextAttacker.post(
      `/api/admin/users/${victimId}/roles`,
      {
        data: { roleName: "staff" },
      },
    );
    expect(res.status()).toBe(403);

    await contextAttacker.dispose();
    await contextVictim.dispose();
  });
});
