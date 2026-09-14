import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

/**
 * The thin HTTP-boundary slice for the Payment domain
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §35): proves the real
 * request -> use-case -> DB path for payment-attempt reads, retry, and
 * the webhook/internal-worker routes' auth boundaries. Exhaustive
 * business-rule coverage (state machines, verify-then-act, refund
 * allocation, concurrency) lives in the integration suite
 * (tests/integration/payment-*.test.ts, refund-lifecycle.test.ts,
 * webhook-processing.test.ts) — this file does not repeat it. No real
 * Paystack secret is configured in this environment, so every
 * initialization attempt resolves cleanly to `INITIALIZATION_FAILED`
 * (plan §8) rather than a real redirect — that clean-failure path is
 * itself part of what this file verifies.
 *
 * Uses Playwright's `request` fixture only (no browser binary), matching
 * every prior phase's established e2e pattern.
 */

function uniqueEmail(label: string): string {
  return `phase8-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

function uniqueName(label: string): string {
  return `Phase8E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// A bare `Date.now()` SKU can collide when two tests in this file create a
// product in the same millisecond under Playwright's fullyParallel workers
// (observed as a real, intermittent 409 in this file) — add a random
// suffix so concurrent tests never collide.
function uniqueSku(): string {
  return `PHASE8E2E-SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PASSWORD = "Sup3rSecretPassword";

async function makeSuperAdmin(email: string): Promise<void> {
  const db = new PrismaClient();
  try {
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const role = await db.role.findUniqueOrThrow({
      where: { name: "super_admin" },
    });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id, assignedBy: null },
      update: {},
    });
  } finally {
    await db.$disconnect();
  }
}

const shippingAddress = {
  fullName: "Payment E2E Customer",
  phone: "+2348012345678",
  addressLine1: "1 Payment Street",
  city: "Lagos",
  state: "Lagos",
  country: "NG",
};

test.describe("payment: real HTTP boundary", () => {
  test("a customer checks out, reads their payment attempts, and retries payment over HTTP", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("payment-admin");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Payment Admin" },
    });
    await makeSuperAdmin(adminEmail);
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });

    const categoryRes = await request.post("/api/admin/catalog/categories", {
      data: { name: uniqueName("Category"), isActive: true },
    });
    expect(categoryRes.status()).toBe(201);
    const { category } = await categoryRes.json();
    const createProductRes = await request.post("/api/catalog/products", {
      data: {
        name: uniqueName("Product"),
        unitOfMeasure: "EACH",
        categoryId: category.id,
        isFeatured: false,
        variant: { sku: uniqueSku(), priceMinor: 200_000 },
      },
    });
    expect(createProductRes.status()).toBe(201);
    const { product } = await createProductRes.json();
    const variantId = product.variants[0].id;
    await request.post(`/api/admin/inventory/${variantId}/restock`, {
      data: { quantity: 10 },
    });

    const customerEmail = uniqueEmail("payment-customer");
    await request.post("/api/auth/sign-up/email", {
      data: {
        email: customerEmail,
        password: PASSWORD,
        name: "Payment Customer",
      },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });

    const addRes = await request.post("/api/cart/items", {
      data: { variantId, quantity: 1 },
    });
    expect(addRes.status()).toBe(201);

    const checkoutRes = await request.post("/api/checkout", {
      data: { shippingAddress },
    });
    expect(checkoutRes.status()).toBe(201);
    const { order, payment } = await checkoutRes.json();
    // No PAYSTACK_SECRET_KEY is configured in this test environment.
    expect(payment.outcome).toBe("INITIALIZATION_FAILED");

    const attemptsRes = await request.get(
      `/api/orders/${order.id}/payment-attempts`,
    );
    expect(attemptsRes.status()).toBe(200);
    const { attempts } = await attemptsRes.json();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("INITIALIZATION_FAILED");

    const retryRes = await request.post(
      `/api/orders/${order.id}/retry-payment`,
      {
        data: {},
      },
    );
    expect(retryRes.status()).toBe(200);
    const { payment: retryPayment } = await retryRes.json();
    expect(retryPayment.outcome).toBe("INITIALIZATION_FAILED");

    const attemptsAfterRetryRes = await request.get(
      `/api/orders/${order.id}/payment-attempts`,
    );
    const { attempts: attemptsAfterRetry } = await attemptsAfterRetryRes.json();
    expect(attemptsAfterRetry).toHaveLength(2); // a NEW attempt, same order
  });

  test("a user cannot read or retry payment for another user's order", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("payment-admin-2");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Payment Admin 2" },
    });
    await makeSuperAdmin(adminEmail);
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });
    const categoryRes = await request.post("/api/admin/catalog/categories", {
      data: { name: uniqueName("Category"), isActive: true },
    });
    const { category } = await categoryRes.json();
    const createProductRes = await request.post("/api/catalog/products", {
      data: {
        name: uniqueName("Product"),
        unitOfMeasure: "EACH",
        categoryId: category.id,
        isFeatured: false,
        variant: { sku: uniqueSku(), priceMinor: 50_000 },
      },
    });
    const { product } = await createProductRes.json();
    const variantId = product.variants[0].id;
    await request.post(`/api/admin/inventory/${variantId}/restock`, {
      data: { quantity: 5 },
    });

    const ownerEmail = uniqueEmail("payment-owner");
    await request.post("/api/auth/sign-up/email", {
      data: { email: ownerEmail, password: PASSWORD, name: "Owner" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: ownerEmail, password: PASSWORD },
    });
    await request.post("/api/cart/items", { data: { variantId, quantity: 1 } });
    const checkoutRes = await request.post("/api/checkout", {
      data: { shippingAddress },
    });
    const { order } = await checkoutRes.json();

    const attackerEmail = uniqueEmail("payment-attacker");
    await request.post("/api/auth/sign-up/email", {
      data: { email: attackerEmail, password: PASSWORD, name: "Attacker" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: attackerEmail, password: PASSWORD },
    });

    const readRes = await request.get(
      `/api/orders/${order.id}/payment-attempts`,
    );
    expect(readRes.status()).toBe(403);

    const retryRes = await request.post(
      `/api/orders/${order.id}/retry-payment`,
      { data: {} },
    );
    expect(retryRes.status()).toBe(403);
  });

  test("unauthenticated requests to payment-attempt reads and retry are rejected", async ({
    request,
  }) => {
    const readRes = await request.get("/api/orders/1/payment-attempts");
    expect(readRes.status()).toBe(401);
    const retryRes = await request.post("/api/orders/1/retry-payment", {
      data: {},
    });
    expect(retryRes.status()).toBe(401);
  });

  test("the webhook route fails closed (503) when Paystack is not configured, never accepting an unverifiable payload", async ({
    request,
  }) => {
    const res = await request.post("/api/paystack/webhook", {
      data: { event: "charge.success", data: { id: 1 } },
      headers: { "x-paystack-signature": "forged" },
    });
    expect(res.status()).toBe(503);
  });

  test("the internal webhook-worker trigger requires machine-to-machine auth, never a user session", async ({
    request,
  }) => {
    // No session at all.
    const anonymousRes = await request.post(
      "/api/internal/process-webhook-events",
      {
        data: {},
      },
    );
    expect([401, 503]).toContain(anonymousRes.status());

    // A logged-in admin's own session cookie is NOT sufficient — this
    // route never checks ordinary user authentication at all.
    const adminEmail = uniqueEmail("payment-admin-3");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Payment Admin 3" },
    });
    await makeSuperAdmin(adminEmail);
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });
    const asAdminRes = await request.post(
      "/api/internal/process-webhook-events",
      { data: {} },
    );
    expect([401, 503]).toContain(asAdminRes.status());
  });

  test("admin refund endpoints require payments.refund — a customer cannot request or cancel a refund", async ({
    request,
  }) => {
    const customerEmail = uniqueEmail("payment-refund-customer");
    await request.post("/api/auth/sign-up/email", {
      data: {
        email: customerEmail,
        password: PASSWORD,
        name: "Refund Customer",
      },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });

    const refundRes = await request.post("/api/admin/payments/1/refunds", {
      data: {},
    });
    expect(refundRes.status()).toBe(403);

    const cancelRes = await request.post(
      "/api/admin/payments/refunds/1/cancel",
      { data: {} },
    );
    expect(cancelRes.status()).toBe(403);

    const reconciliationRes = await request.get(
      "/api/admin/payments/reconciliation",
    );
    expect(reconciliationRes.status()).toBe(403);
  });

  test("an unauthenticated request to any admin payment endpoint is rejected before any permission check", async ({
    request,
  }) => {
    const refundRes = await request.post("/api/admin/payments/1/refunds", {
      data: {},
    });
    expect(refundRes.status()).toBe(401);
    const reconciliationRes = await request.get(
      "/api/admin/payments/reconciliation",
    );
    expect(reconciliationRes.status()).toBe(401);
  });
});
