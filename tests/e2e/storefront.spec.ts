import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

/**
 * The thin HTTP-boundary slice for the Phase 9 storefront
 * (docs/PHASE_9_STOREFRONT_PLAN.md §24): proves the real request -> page
 * data-loader/use-case -> DB path for catalog browsing/search/filtering,
 * product detail, cart mutations, guest->authenticated cart merge,
 * authenticated and guest checkout, payment-initialization-failure
 * behavior, payment retry, order history/detail, IDOR protection, and
 * the guest payment-result access token (including its rejection paths).
 * Exhaustive business-rule coverage lives in the integration suite
 * (tests/integration/catalog-storefront.test.ts, guest-order-access.test.ts,
 * payment-*.test.ts, checkout-*.test.ts) — this file does not repeat it.
 *
 * Uses Playwright's `request` fixture only (no browser binary), matching
 * every prior phase's established e2e pattern. Hits the same real
 * `/api/**` routes and public catalog/order/payment reads the storefront
 * pages themselves call server-side.
 */

function uniqueEmail(label: string): string {
  return `phase9-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

function uniqueName(label: string): string {
  return `Phase9E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueSku(): string {
  return `PHASE9E2E-SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  fullName: "Storefront E2E Customer",
  phone: "+2348012345678",
  addressLine1: "1 Storefront Street",
  city: "Lagos",
  state: "Lagos",
  country: "NG",
};

async function createAdminAndProduct(
  request: import("@playwright/test").APIRequestContext,
  overrides: {
    priceMinor?: number;
    powerRatingW?: number;
    phase?: "SINGLE" | "THREE";
    isFeatured?: boolean;
    quantity?: number;
  } = {},
) {
  const adminEmail = uniqueEmail("admin");
  await request.post("/api/auth/sign-up/email", {
    data: { email: adminEmail, password: PASSWORD, name: "Storefront Admin" },
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
      isFeatured: overrides.isFeatured ?? false,
      variant: {
        sku: uniqueSku(),
        priceMinor: overrides.priceMinor ?? 200_000,
        powerRatingW: overrides.powerRatingW,
        phase: overrides.phase,
      },
    },
  });
  const { product } = await createProductRes.json();
  const variantId = product.variants[0].id;

  await request.post(`/api/admin/catalog/products/${product.id}/publish`, {
    data: {},
  });
  await request.post(`/api/admin/inventory/${variantId}/restock`, {
    data: { quantity: overrides.quantity ?? 10 },
  });

  // Every caller shares one `request` context per test (Playwright keeps
  // cookies across calls within a test) — leaving the admin session
  // active here would silently turn every subsequent "guest"/"customer"
  // action in the test into an admin-authenticated one instead. Logging
  // out restores the clean, unauthenticated starting point callers expect.
  await request.post("/api/auth/sign-out", { data: {} });

  return { category, product, variantId };
}

test.describe("storefront: real HTTP boundary", () => {
  test("browses the public catalog listing and reads a product by slug", async ({
    request,
  }) => {
    const { product } = await createAdminAndProduct(request);

    const listRes = await request.get("/api/catalog/products");
    expect(listRes.status()).toBe(200);
    const { items } = await listRes.json();
    expect(items.map((p: { slug: string }) => p.slug)).toContain(product.slug);

    const detailRes = await request.get(
      `/api/catalog/products/${product.slug}`,
    );
    expect(detailRes.status()).toBe(200);
    const { product: detail } = await detailRes.json();
    expect(detail.slug).toBe(product.slug);
  });

  test("search finds a product by name substring", async ({ request }) => {
    const { product } = await createAdminAndProduct(request);
    const searchTerm = product.name.split(" ").slice(-1)[0];

    const res = await request.get(
      `/api/catalog/products?search=${encodeURIComponent(searchTerm)}`,
    );
    expect(res.status()).toBe(200);
    const { items } = await res.json();
    expect(items.map((p: { slug: string }) => p.slug)).toContain(product.slug);
  });

  test("filtering by category, price range, power rating, and phase all narrow the listing", async ({
    request,
  }) => {
    const { category, product } = await createAdminAndProduct(request, {
      priceMinor: 500_000,
      powerRatingW: 5000,
      phase: "THREE",
    });

    const byCategory = await request.get(
      `/api/catalog/products?categoryId=${category.id}`,
    );
    expect(
      (await byCategory.json()).items.map((p: { slug: string }) => p.slug),
    ).toContain(product.slug);

    const byPrice = await request.get(
      `/api/catalog/products?categoryId=${category.id}&minPriceMinor=400000&maxPriceMinor=600000`,
    );
    expect(
      (await byPrice.json()).items.map((p: { slug: string }) => p.slug),
    ).toContain(product.slug);

    const byPower = await request.get(
      `/api/catalog/products?categoryId=${category.id}&powerRatingWMin=3000&phase=THREE`,
    );
    expect(
      (await byPower.json()).items.map((p: { slug: string }) => p.slug),
    ).toContain(product.slug);

    const excludedByPrice = await request.get(
      `/api/catalog/products?categoryId=${category.id}&minPriceMinor=900000`,
    );
    expect(
      (await excludedByPrice.json()).items.map((p: { slug: string }) => p.slug),
    ).not.toContain(product.slug);
  });

  test("sortBy=featured surfaces a featured product ahead of a non-featured one", async ({
    request,
  }) => {
    const { category, product: featured } = await createAdminAndProduct(
      request,
      {
        isFeatured: true,
      },
    );
    await createAdminAndProduct(request, { isFeatured: false });

    const res = await request.get(
      `/api/catalog/products?categoryId=${category.id}&sortBy=featured`,
    );
    const { items } = await res.json();
    const featuredIndex = items.findIndex(
      (p: { slug: string }) => p.slug === featured.slug,
    );
    expect(featuredIndex).toBe(0);
  });

  test("a guest adds to cart, updates quantity, then removes the item", async ({
    request,
  }) => {
    const { variantId } = await createAdminAndProduct(request);

    const addRes = await request.post("/api/cart/items", {
      data: { variantId, quantity: 2 },
    });
    expect(addRes.status()).toBe(201);
    const { cart } = await addRes.json();
    const itemId = cart.items[0].id;

    const updateRes = await request.patch(`/api/cart/items/${itemId}`, {
      data: { quantity: 5 },
    });
    expect(updateRes.status()).toBe(200);
    expect((await updateRes.json()).cart.items[0].quantity).toBe(5);

    const removeRes = await request.delete(`/api/cart/items/${itemId}`);
    expect(removeRes.status()).toBe(200);
    expect((await removeRes.json()).cart.items).toHaveLength(0);
  });

  test("a guest's cart merges into their cart on login", async ({
    request,
  }) => {
    const { variantId } = await createAdminAndProduct(request);

    await request.post("/api/cart/items", { data: { variantId, quantity: 1 } });

    const email = uniqueEmail("merge-customer");
    await request.post("/api/auth/sign-up/email", {
      data: { email, password: PASSWORD, name: "Merge Customer" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email, password: PASSWORD },
    });

    const cartRes = await request.get("/api/cart");
    const { cart } = await cartRes.json();
    expect(cart).not.toBeNull();
    expect(
      cart.items.some(
        (i: { productVariantId: string }) => i.productVariantId === variantId,
      ),
    ).toBe(true);
  });

  test("authenticated checkout completes with INITIALIZATION_FAILED (no PAYSTACK_SECRET_KEY configured) and retry creates a new attempt", async ({
    request,
  }) => {
    const { variantId } = await createAdminAndProduct(request);
    const email = uniqueEmail("authed-checkout");
    await request.post("/api/auth/sign-up/email", {
      data: { email, password: PASSWORD, name: "Authed Checkout" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email, password: PASSWORD },
    });
    await request.post("/api/cart/items", { data: { variantId, quantity: 1 } });

    const checkoutRes = await request.post("/api/checkout", {
      data: { shippingAddress },
    });
    expect(checkoutRes.status()).toBe(201);
    const { order, payment, guestOrderAccessToken } = await checkoutRes.json();
    expect(payment.outcome).toBe("INITIALIZATION_FAILED");
    expect(guestOrderAccessToken).toBeUndefined(); // never issued for an authenticated order

    const retryRes = await request.post(
      `/api/orders/${order.id}/retry-payment`,
      { data: {} },
    );
    expect(retryRes.status()).toBe(200);
    expect((await retryRes.json()).payment.outcome).toBe(
      "INITIALIZATION_FAILED",
    );

    const attemptsRes = await request.get(
      `/api/orders/${order.id}/payment-attempts`,
    );
    const { attempts } = await attemptsRes.json();
    expect(attempts).toHaveLength(2); // the retry created a NEW attempt on the SAME order
  });

  test("guest checkout completes, issues a guestOrderAccessToken, and the token authorizes payment-result reads/retries", async ({
    request,
  }) => {
    const { variantId } = await createAdminAndProduct(request);
    await request.post("/api/cart/items", { data: { variantId, quantity: 1 } });

    const checkoutRes = await request.post("/api/checkout", {
      data: { shippingAddress, guestEmail: uniqueEmail("guest-checkout") },
    });
    expect(checkoutRes.status()).toBe(201);
    const { order, guestOrderAccessToken } = await checkoutRes.json();
    expect(guestOrderAccessToken).toBeTruthy();

    // Fresh, cookie-less context: a guest has no session at all.
    const attemptsRes = await request.get(
      `/api/orders/${order.id}/payment-attempts?guestToken=${encodeURIComponent(guestOrderAccessToken)}`,
    );
    expect(attemptsRes.status()).toBe(200);
    const { attempts } = await attemptsRes.json();
    expect(attempts.length).toBeGreaterThan(0);

    const retryRes = await request.post(
      `/api/orders/${order.id}/retry-payment`,
      {
        data: { guestToken: guestOrderAccessToken },
      },
    );
    expect(retryRes.status()).toBe(200);
    expect((await retryRes.json()).payment.outcome).toBe(
      "INITIALIZATION_FAILED",
    );
  });

  test("a tampered guest token is rejected — never authorizes payment-result access", async ({
    request,
  }) => {
    const { variantId } = await createAdminAndProduct(request);
    await request.post("/api/cart/items", { data: { variantId, quantity: 1 } });
    const checkoutRes = await request.post("/api/checkout", {
      data: { shippingAddress, guestEmail: uniqueEmail("tampered-token") },
    });
    const { order, guestOrderAccessToken } = await checkoutRes.json();

    const tampered =
      guestOrderAccessToken.slice(0, -1) +
      (guestOrderAccessToken.endsWith("A") ? "B" : "A");

    const res = await request.get(
      `/api/orders/${order.id}/payment-attempts?guestToken=${encodeURIComponent(tampered)}`,
    );
    expect(res.status()).toBe(401);
  });

  test("a guest token scoped to one order is rejected for a different order", async ({
    request,
  }) => {
    const { variantId: variantId1 } = await createAdminAndProduct(request);
    await request.post("/api/cart/items", {
      data: { variantId: variantId1, quantity: 1 },
    });
    const checkoutRes1 = await request.post("/api/checkout", {
      data: { shippingAddress, guestEmail: uniqueEmail("guest-a") },
    });
    const { guestOrderAccessToken: tokenA } = await checkoutRes1.json();

    const { variantId: variantId2 } = await createAdminAndProduct(request);
    await request.post("/api/cart/items", {
      data: { variantId: variantId2, quantity: 1 },
    });
    const checkoutRes2 = await request.post("/api/checkout", {
      data: { shippingAddress, guestEmail: uniqueEmail("guest-b") },
    });
    const { order: orderB } = await checkoutRes2.json();

    const res = await request.get(
      `/api/orders/${orderB.id}/payment-attempts?guestToken=${encodeURIComponent(tokenA)}`,
    );
    expect(res.status()).toBe(401);
  });

  test("an authenticated customer reads their order history and a single order's detail", async ({
    request,
  }) => {
    const { variantId } = await createAdminAndProduct(request);
    const email = uniqueEmail("order-history");
    await request.post("/api/auth/sign-up/email", {
      data: { email, password: PASSWORD, name: "Order History" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email, password: PASSWORD },
    });
    await request.post("/api/cart/items", { data: { variantId, quantity: 1 } });
    const checkoutRes = await request.post("/api/checkout", {
      data: { shippingAddress },
    });
    const { order } = await checkoutRes.json();

    const listRes = await request.get("/api/orders");
    expect(listRes.status()).toBe(200);
    const { items } = await listRes.json();
    expect(items.map((o: { id: string }) => o.id)).toContain(order.id);

    const detailRes = await request.get(`/api/orders/${order.id}`);
    expect(detailRes.status()).toBe(200);
    expect((await detailRes.json()).order.id).toBe(order.id);
  });

  test("IDOR: a different authenticated user cannot read another customer's order or payment attempts", async ({
    request,
  }) => {
    const { variantId } = await createAdminAndProduct(request);
    const ownerEmail = uniqueEmail("idor-owner");
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

    const attackerEmail = uniqueEmail("idor-attacker");
    await request.post("/api/auth/sign-up/email", {
      data: { email: attackerEmail, password: PASSWORD, name: "Attacker" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: attackerEmail, password: PASSWORD },
    });

    expect((await request.get(`/api/orders/${order.id}`)).status()).toBe(403);
    expect(
      (await request.get(`/api/orders/${order.id}/payment-attempts`)).status(),
    ).toBe(403);
    expect(
      (
        await request.post(`/api/orders/${order.id}/retry-payment`, {
          data: {},
        })
      ).status(),
    ).toBe(403);
  });
});
