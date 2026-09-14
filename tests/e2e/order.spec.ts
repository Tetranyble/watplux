import { PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * The thin HTTP-boundary slice for the order domain
 * (docs/PHASE_6_ORDER_PLAN.md §23): proves the real
 * request -> use-case -> DB path end-to-end for the customer order/read/cancel routes plus
 * one forged-field-over-HTTP privilege-escalation check. Exhaustive
 * business-rule coverage (invariants, concurrency, authorization matrix,
 * payment-attempt/order mismatch) lives in the integration suite
 * (tests/integration/order-*.test.ts) — this file does not repeat it.
 * No UI or webhooks; order creation intentionally traverses Cart + Checkout (`markOrderPaid`
 * has no route — inter-module contract only, exercised directly in
 * integration tests).
 *
 * Uses Playwright's `request` fixture only (no browser binary), matching
 * tests/e2e/inventory.spec.ts's established pattern.
 */

function uniqueEmail(label: string): string {
  return `phase6-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

function uniqueName(label: string): string {
  return `Phase6E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  fullName: "E2E Customer",
  phone: "+2348012345678",
  addressLine1: "1 E2E Street",
  city: "Lagos",
  state: "Lagos",
  country: "NG",
};

async function checkoutVariant(
  request: APIRequestContext,
  variantId: string,
  quantity: number,
  extra: Record<string, unknown> = {},
) {
  const addRes = await request.post("/api/cart/items", {
    data: { variantId, quantity },
  });
  expect(addRes.status()).toBe(201);

  return request.post("/api/checkout", {
    data: { shippingAddress, ...extra },
  });
}

test.describe("order: real HTTP boundary", () => {
  test("a customer creates an order over HTTP, reads it back, and cancels it", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("order-admin");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Order Admin" },
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
        variant: { sku: `PHASE6E2E-SKU-${Date.now()}`, priceMinor: 250_000 },
      },
    });
    expect(createProductRes.status()).toBe(201);
    const { product } = await createProductRes.json();
    const variantId = product.variants[0].id;

    const restockRes = await request.post(
      `/api/admin/inventory/${variantId}/restock`,
      { data: { quantity: 10 } },
    );
    expect(restockRes.status()).toBe(201);

    // A separate, genuinely authenticated customer session — its own
    // cookie jar, never touched by the admin login above.
    const customerEmail = uniqueEmail("order-customer");
    await request.post("/api/auth/sign-up/email", {
      data: { email: customerEmail, password: PASSWORD, name: "Customer" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });

    const createOrderRes = await checkoutVariant(request, variantId, 2);
    expect(createOrderRes.status()).toBe(201);
    const { order } = await createOrderRes.json();
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(2);
    expect(order.totalMinor).toBe(500_000);

    const readRes = await request.get(`/api/orders/${order.id}`);
    expect(readRes.status()).toBe(200);
    const { order: readBack } = await readRes.json();
    expect(readBack.id).toBe(order.id);

    const byNumberRes = await request.get(
      `/api/orders/by-number/${order.orderNumber}`,
    );
    expect(byNumberRes.status()).toBe(200);

    const listRes = await request.get("/api/orders");
    expect(listRes.status()).toBe(200);
    const { items } = await listRes.json();
    expect(items.some((o: { id: string }) => o.id === order.id)).toBe(true);

    const cancelRes = await request.post(`/api/orders/${order.id}/cancel`, {
      data: {},
    });
    expect(cancelRes.status()).toBe(200);
    const { order: cancelled } = await cancelRes.json();
    expect(cancelled.status).toBe("CANCELLED");

    // Log back in as the admin — the inventory balance endpoint is
    // admin-only, and the customer session above cannot read it.
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });
    const balanceRes = await request.get(`/api/admin/inventory/${variantId}`);
    expect(balanceRes.status()).toBe(200);
    const { inventory } = await balanceRes.json();
    expect(inventory.quantityReserved).toBe(0);
  });

  test("an admin lists and reads any order via the admin endpoints", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("order-admin-2");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Order Admin 2" },
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
        variant: { sku: `PHASE6E2E-SKU-${Date.now()}`, priceMinor: 100_000 },
      },
    });
    const { product } = await createProductRes.json();
    const variantId = product.variants[0].id;
    await request.post(`/api/admin/inventory/${variantId}/restock`, {
      data: { quantity: 5 },
    });

    const customerEmail = uniqueEmail("order-customer-2");
    await request.post("/api/auth/sign-up/email", {
      data: { email: customerEmail, password: PASSWORD, name: "Customer 2" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });
    const createOrderRes = await checkoutVariant(request, variantId, 1);
    const { order } = await createOrderRes.json();

    // Log back in as the admin to use the admin-only endpoints.
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });

    const adminListRes = await request.get("/api/admin/orders");
    expect(adminListRes.status()).toBe(200);
    const { items } = await adminListRes.json();
    expect(items.some((o: { id: string }) => o.id === order.id)).toBe(true);

    const adminDetailRes = await request.get(`/api/admin/orders/${order.id}`);
    expect(adminDetailRes.status()).toBe(200);
  });

  test("a customer's forged status/total fields on order creation have no effect — the server always computes them", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("order-admin-3");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Order Admin 3" },
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
        variant: { sku: `PHASE6E2E-SKU-${Date.now()}`, priceMinor: 100_000 },
      },
    });
    const { product } = await createProductRes.json();
    const variantId = product.variants[0].id;
    await request.post(`/api/admin/inventory/${variantId}/restock`, {
      data: { quantity: 5 },
    });

    const customerEmail = uniqueEmail("order-customer-3");
    await request.post("/api/auth/sign-up/email", {
      data: { email: customerEmail, password: PASSWORD, name: "Customer 3" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });

    const addRes = await request.post("/api/cart/items", {
      data: { variantId, quantity: 1 },
    });
    expect(addRes.status()).toBe(201);
    const res = await request.post("/api/checkout", {
      data: {
        shippingAddress,
        // Forged fields a naive implementation might mistakenly trust.
        // Checkout accepts only its schema and recomputes totals server-side.
        status: "PAID",
        totalMinor: 1,
        subtotalMinor: 1,
        userId: "999999999999",
      },
    });
    expect(res.status()).toBe(201);
    const { order } = await res.json();
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.totalMinor).toBe(100_000);
  });

  test("an unauthenticated request to a mutating order endpoint is rejected before any permission check", async ({
    request,
  }) => {
    const res = await request.post("/api/orders/1/cancel", { data: {} });
    expect(res.status()).toBe(401);
  });

  test("an unauthenticated request to a read order endpoint is also rejected — no public order data", async ({
    request,
  }) => {
    const res = await request.get("/api/orders");
    expect(res.status()).toBe(401);
  });
});
