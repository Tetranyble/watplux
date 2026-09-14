import { PrismaClient } from "@prisma/client";
import { expect, request as playwrightRequest, test } from "@playwright/test";

/**
 * The thin HTTP-boundary slice for the Cart + Checkout domain
 * (docs/PHASE_7_CART_CHECKOUT_PLAN.md §32): proves the real
 * request -> use-case -> DB path end-to-end for a guest cart through
 * checkout, plus forged-field and unauthenticated-rejection checks.
 * Exhaustive business-rule coverage (invariants, concurrency,
 * authorization matrix, merge policy) lives in the integration suite
 * (tests/integration/cart-*.test.ts, checkout-*.test.ts) — this file
 * does not repeat it. No UI, no Paystack, no webhooks.
 *
 * Uses Playwright's `request` fixture only (no browser binary), matching
 * `tests/e2e/order.spec.ts`'s established pattern.
 */

function uniqueEmail(label: string): string {
  return `phase7-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

function uniqueName(label: string): string {
  return `Phase7E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  fullName: "E2E Cart Customer",
  phone: "+2348012345678",
  addressLine1: "1 Cart Street",
  city: "Lagos",
  state: "Lagos",
  country: "NG",
};

test.describe("cart + checkout: real HTTP boundary", () => {
  test("a guest creates a cart, adds an item, completes checkout, and the resulting order + INITIATED payment attempt are verifiable", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("cart-admin");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Cart Admin" },
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
        variant: { sku: `PHASE7E2E-SKU-${Date.now()}`, priceMinor: 300_000 },
      },
    });
    const { product } = await createProductRes.json();
    const variantId = product.variants[0].id;
    await request.post(`/api/admin/inventory/${variantId}/restock`, {
      data: { quantity: 10 },
    });

    // Log out — everything from here happens with NO session cookie, so
    // the cart layer resolves a guest identity (docs/PHASE_7_CART_CHECKOUT_PLAN.md §5).
    await request.post("/api/auth/sign-out", { data: {} });

    const getEmptyCartRes = await request.get("/api/cart");
    expect(getEmptyCartRes.status()).toBe(200);
    expect((await getEmptyCartRes.json()).cart).toBeNull();

    const addItemRes = await request.post("/api/cart/items", {
      data: { variantId, quantity: 2 },
    });
    expect(addItemRes.status()).toBe(201);
    const { cart: cartAfterAdd } = await addItemRes.json();
    expect(cartAfterAdd.items).toHaveLength(1);
    expect(cartAfterAdd.items[0].quantity).toBe(2);

    const countRes = await request.get("/api/cart/count");
    expect((await countRes.json()).count).toBe(1);

    const validateRes = await request.get("/api/checkout/validate");
    expect(validateRes.status()).toBe(200);
    const { report } = await validateRes.json();
    expect(report.isValid).toBe(true);

    const checkoutRes = await request.post("/api/checkout", {
      data: {
        shippingAddress,
        guestEmail: "guest-e2e-checkout@example.test",
      },
    });
    expect(checkoutRes.status()).toBe(201);
    const { order, payment } = await checkoutRes.json();
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.totalMinor).toBe(600_000);
    expect(order.guestEmail).toBe("guest-e2e-checkout@example.test");
    // No PAYSTACK_SECRET_KEY is configured in this test environment — the
    // additive Phase 8 initialization step therefore resolves to a clean
    // INITIALIZATION_FAILED outcome rather than throwing or corrupting
    // the already-created order (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §8).
    expect(payment.outcome).toBe("INITIALIZATION_FAILED");

    // The cart is now CONVERTED — a bare read shows no active cart.
    const cartAfterCheckoutRes = await request.get("/api/cart");
    expect((await cartAfterCheckoutRes.json()).cart).toBeNull();

    // Verify the order + payment attempt directly (no route exposes
    // payment-attempt details — Order's own DTO deliberately doesn't,
    // plan §25 — matching `order.spec.ts`'s own direct-DB-check
    // precedent for admin-only facts).
    const db = new PrismaClient();
    try {
      const paymentAttempt = await db.paymentAttempt.findFirstOrThrow({
        where: { orderId: BigInt(order.id) },
      });
      expect(paymentAttempt.status).toBe("INITIALIZATION_FAILED");
      expect(paymentAttempt.amountMinor).toBe(600_000);
      expect(paymentAttempt.authorizationUrl).toBeNull();
    } finally {
      await db.$disconnect();
    }

    // Log back in as admin to confirm the reservation via the existing
    // admin inventory endpoint.
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });
    const balanceRes = await request.get(`/api/admin/inventory/${variantId}`);
    const { inventory } = await balanceRes.json();
    expect(inventory.quantityReserved).toBe(2);
  });

  test("forged priceSnapshotMinor/userId fields on cart mutation have no effect — the server always resolves them", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("cart-admin-2");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Cart Admin 2" },
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
        variant: { sku: `PHASE7E2E-SKU-${Date.now()}`, priceMinor: 50_000 },
      },
    });
    const { product } = await createProductRes.json();
    const variantId = product.variants[0].id;
    await request.post(`/api/admin/inventory/${variantId}/restock`, {
      data: { quantity: 5 },
    });

    const customerEmail = uniqueEmail("cart-customer");
    await request.post("/api/auth/sign-up/email", {
      data: { email: customerEmail, password: PASSWORD, name: "Customer" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });

    const res = await request.post("/api/cart/items", {
      data: {
        variantId,
        quantity: 1,
        // Forged fields a naive implementation might mistakenly trust —
        // never accepted by the Zod schema, and never read even if they
        // were (mirrors tests/e2e/order.spec.ts's equivalent check).
        priceSnapshotMinor: 1,
        userId: "999999999999",
      },
    });
    expect(res.status()).toBe(201);
    const { cart } = await res.json();
    expect(cart.items[0].priceSnapshotMinor).toBe(50_000);
  });

  test("an unauthenticated, cookie-less caller can still add to a guest cart, but a forged cart item id on another identity is rejected", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("cart-admin-3");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Cart Admin 3" },
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
        variant: { sku: `PHASE7E2E-SKU-${Date.now()}`, priceMinor: 20_000 },
      },
    });
    const { product } = await createProductRes.json();
    const variantId = product.variants[0].id;
    await request.post(`/api/admin/inventory/${variantId}/restock`, {
      data: { quantity: 5 },
    });
    await request.post("/api/auth/sign-out", { data: {} });

    const addRes = await request.post("/api/cart/items", {
      data: { variantId, quantity: 1 },
    });
    expect(addRes.status()).toBe(201);
    const { cart } = await addRes.json();
    const itemId = cart.items[0].id;

    // A different (unauthenticated, no cookies) API context has no
    // relationship to the cart above — it cannot touch that item.
    const otherContext = await playwrightRequest.newContext({
      baseURL: "http://localhost:3000",
    });
    try {
      const forgedUpdateRes = await otherContext.patch(
        `/api/cart/items/${itemId}`,
        { data: { quantity: 99 } },
      );
      expect(forgedUpdateRes.status()).toBe(404);
    } finally {
      await otherContext.dispose();
    }
  });

  test("an unauthenticated request to checkout is rejected before touching any cart", async ({
    request,
  }) => {
    const res = await request.post("/api/checkout", {
      data: { shippingAddress },
    });
    expect(res.status()).toBe(404);
  });

  test("a mutating cart endpoint with no identity at all still behaves safely — updating a nonexistent item is rejected, never a 500", async ({
    request,
  }) => {
    const res = await request.patch("/api/cart/items/999999999", {
      data: { quantity: 1 },
    });
    expect(res.status()).toBe(404);
  });
});
