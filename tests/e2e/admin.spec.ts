import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

/**
 * The thin HTTP-boundary slice for the Phase 10 Admin Operations
 * Dashboard (docs/PHASE_10_ADMIN_PLAN.md §19): proves navigation
 * gating, direct-URL rejection, and the real request -> use-case -> DB
 * path for every admin screen added this phase, plus the mechanical
 * routes wired directly by this phase (product create, variant
 * reactivate, image update/remove, specification remove, category/brand
 * activate/deactivate/update, admin category/brand `publicOnly=false`
 * reads, the order list's date/search filters, and the admin-wide refund
 * queue). Exhaustive business-rule coverage (invariants, concurrency,
 * authorization matrices) lives in the integration suite
 * (tests/integration/*.test.ts) — this file does not repeat it.
 *
 * Audit Logs has NO e2e coverage here — that capability is deferred
 * (approval Q1: "Deferred: audit-log read capability").
 *
 * Uses Playwright's `request` fixture only (no browser binary), matching
 * every prior phase's e2e convention (`tests/e2e/catalog.spec.ts`,
 * `inventory.spec.ts`, `order.spec.ts`, `payment.spec.ts`).
 */

function uniqueEmail(label: string): string {
  return `phase10-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

function uniqueName(label: string): string {
  return `Phase10E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

async function makeStaff(email: string): Promise<void> {
  const db = new PrismaClient();
  try {
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const role = await db.role.findUniqueOrThrow({ where: { name: "staff" } });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id, assignedBy: null },
      update: {},
    });
  } finally {
    await db.$disconnect();
  }
}

async function findUserRoleNames(email: string): Promise<string[]> {
  const db = new PrismaClient();
  try {
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const roles = await db.userRole.findMany({
      where: { userId: user.id },
      include: { role: true },
    });
    return roles.map((r) => r.role.name);
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

test.describe("admin: shell navigation and access control", () => {
  test("an unauthenticated visitor requesting /admin is redirected to login", async ({
    request,
  }) => {
    const res = await request.get("/admin");
    expect(res.url()).toContain("/login");
  });

  test("a customer (zero admin permissions) visiting /admin is redirected to their account", async ({
    request,
  }) => {
    const customerEmail = uniqueEmail("shell-customer");
    await request.post("/api/auth/sign-up/email", {
      data: { email: customerEmail, password: PASSWORD, name: "Customer" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });

    // This route participates in Cache Components/PPR — `redirect("/account")`
    // fires from inside the dynamic (cookie-dependent) part of the render,
    // so it surfaces as a `NEXT_REDIRECT` marker inside the streamed RSC
    // payload rather than a top-level HTTP 307/Location header for a
    // non-JS HTTP client (a real browser resolves this correctly via
    // client-side navigation; verified manually against a running server —
    // `res.url()`/`res.status()` cannot observe it here). Asserting on the
    // embedded redirect instruction is the reliable, HTTP-client-visible
    // proof that the layout's permission gate actually fired.
    const res = await request.get("/admin");
    const body = await res.text();
    expect(body).toContain("NEXT_REDIRECT");
    expect(body).toContain("/account");
  });

  test("super_admin can load the dashboard", async ({ request }) => {
    const adminEmail = uniqueEmail("shell-admin");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Admin" },
    });
    await makeSuperAdmin(adminEmail);
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });

    const res = await request.get("/admin");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Dashboard");
  });

  test("staff can load a permitted section (/admin/orders)", async ({
    request,
  }) => {
    const staffEmail = uniqueEmail("shell-staff");
    await request.post("/api/auth/sign-up/email", {
      data: { email: staffEmail, password: PASSWORD, name: "Staff" },
    });
    await makeStaff(staffEmail);
    await request.post("/api/auth/sign-in/email", {
      data: { email: staffEmail, password: PASSWORD },
    });

    const res = await request.get("/admin/orders");
    expect(res.status()).toBe(200);
  });

  test("staff cannot access the customer detail screen for another user by entering the URL directly", async ({
    request,
  }) => {
    const staffEmail = uniqueEmail("shell-staff-customers");
    await request.post("/api/auth/sign-up/email", {
      data: { email: staffEmail, password: PASSWORD, name: "Staff" },
    });
    await makeStaff(staffEmail);

    const strangerEmail = uniqueEmail("shell-stranger");
    await request.post("/api/auth/sign-up/email", {
      data: { email: strangerEmail, password: PASSWORD, name: "Stranger" },
    });
    const db = new PrismaClient();
    const stranger = await db.user.findUniqueOrThrow({
      where: { email: strangerEmail },
    });
    await db.$disconnect();

    await request.post("/api/auth/sign-in/email", {
      data: { email: staffEmail, password: PASSWORD },
    });

    // Same Cache Components/PPR caveat as the redirect test above — the
    // thrown `ForbiddenError` surfaces as an error digest embedded in the
    // streamed RSC payload (HTTP status stays 200 for a non-JS client;
    // verified manually against a running server), not a top-level 4xx/5xx.
    // The security property that actually matters — the stranger's data
    // never renders — is directly observable and asserted here.
    const res = await request.get(`/admin/customers/${stranger.id}`);
    const body = await res.text();
    expect(body).not.toContain(strangerEmail);
    expect(body).toContain("digest");
  });

  test("an unauthorized (customer) direct API call to a new admin catalog route is rejected", async ({
    request,
  }) => {
    const customerEmail = uniqueEmail("shell-forged");
    await request.post("/api/auth/sign-up/email", {
      data: { email: customerEmail, password: PASSWORD, name: "Customer" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });

    const res = await request.post("/api/admin/catalog/products", {
      data: {
        name: uniqueName("ShouldNotExist"),
        unitOfMeasure: "EACH",
        categoryId: "1",
        isFeatured: false,
        variant: { sku: `PHASE10-FORGED-${Date.now()}`, priceMinor: 1000 },
      },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("admin: catalog CRUD (products, variants, images, specifications)", () => {
  test("an admin creates, publishes, and archives a product via the new admin create route", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("catalog-admin");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Catalog Admin" },
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

    // The route this phase added — previously only GET existed here.
    const createRes = await request.post("/api/admin/catalog/products", {
      data: {
        name: uniqueName("Product"),
        unitOfMeasure: "EACH",
        categoryId: category.id,
        isFeatured: false,
        variant: { sku: `PHASE10-SKU-${Date.now()}`, priceMinor: 300_000 },
      },
    });
    expect(createRes.status()).toBe(201);
    const { product } = await createRes.json();
    expect(product.status).toBe("DRAFT");
    const variantId = product.variants[0].id;

    const publishRes = await request.post(
      `/api/admin/catalog/products/${product.id}/publish`,
    );
    expect(publishRes.status()).toBe(200);

    const archiveRes = await request.post(
      `/api/admin/catalog/products/${product.id}/archive`,
    );
    expect(archiveRes.status()).toBe(200);
    const { product: archived } = await archiveRes.json();
    expect(archived.status).toBe("ARCHIVED");

    // Variant reactivate — the new route this phase added.
    const archiveVariantRes = await request.post(
      `/api/admin/catalog/variants/${variantId}/archive`,
    );
    // Archiving the product's only variant is rejected — proves the
    // default-variant invariant is still enforced through the new routes.
    expect(archiveVariantRes.status()).toBe(400);

    // Add a second variant so the first can be archived, then reactivated.
    const secondVariantRes = await request.post(
      `/api/admin/catalog/products/${product.id}/variants`,
      { data: { sku: `PHASE10-SKU2-${Date.now()}`, priceMinor: 320_000 } },
    );
    expect(secondVariantRes.status()).toBe(201);

    const archiveFirstRes = await request.post(
      `/api/admin/catalog/variants/${variantId}/archive`,
    );
    expect(archiveFirstRes.status()).toBe(200);
    const { variant: archivedVariant } = await archiveFirstRes.json();
    expect(archivedVariant.status).toBe("ARCHIVED");

    const reactivateRes = await request.post(
      `/api/admin/catalog/variants/${variantId}/reactivate`,
    );
    expect(reactivateRes.status()).toBe(200);
    const { variant: reactivated } = await reactivateRes.json();
    expect(reactivated.status).toBe("ACTIVE");

    // Image add/update/remove — update and remove routes are new this phase.
    const addImageRes = await request.post(
      `/api/admin/catalog/products/${product.id}/images`,
      { data: { url: "https://cdn.example.test/phase10.jpg" } },
    );
    expect(addImageRes.status()).toBe(201);
    const { image } = await addImageRes.json();

    const updateImageRes = await request.patch(
      `/api/admin/catalog/images/${image.id}`,
      { data: { altText: "Updated alt text" } },
    );
    expect(updateImageRes.status()).toBe(200);
    const { image: updatedImage } = await updateImageRes.json();
    expect(updatedImage.altText).toBe("Updated alt text");

    const removeImageRes = await request.delete(
      `/api/admin/catalog/images/${image.id}`,
    );
    expect(removeImageRes.status()).toBe(204);

    // Specification upsert/remove — remove route is new this phase.
    const upsertSpecRes = await request.post(
      `/api/admin/catalog/products/${product.id}/specifications`,
      { data: { specKey: "cell_type", specValue: "Monocrystalline" } },
    );
    expect(upsertSpecRes.status()).toBe(200);

    const removeSpecRes = await request.delete(
      `/api/admin/catalog/products/${product.id}/specifications/cell_type`,
    );
    expect(removeSpecRes.status()).toBe(204);
  });

  test("admin category management: create, admin-list includes inactive, deactivate hides it from the public list", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("category-admin");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Category Admin" },
    });
    await makeSuperAdmin(adminEmail);
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });

    const name = uniqueName("Category");
    const createRes = await request.post("/api/admin/catalog/categories", {
      data: { name, isActive: true },
    });
    expect(createRes.status()).toBe(201);
    const { category } = await createRes.json();

    // The new admin GET route (publicOnly=false) this phase added.
    const adminListRes = await request.get("/api/admin/catalog/categories");
    expect(adminListRes.status()).toBe(200);

    const deactivateRes = await request.post(
      `/api/admin/catalog/categories/${category.id}/deactivate`,
    );
    expect(deactivateRes.status()).toBe(200);
    const { category: deactivated } = await deactivateRes.json();
    expect(deactivated.isActive).toBe(false);

    function findInTree(
      nodes: { id: string; children: unknown[] }[],
      id: string,
    ): boolean {
      return nodes.some(
        (n) => n.id === id || findInTree(n.children as typeof nodes, id),
      );
    }

    const adminAfter = await (
      await request.get("/api/admin/catalog/categories")
    ).json();
    expect(findInTree(adminAfter.categories, category.id)).toBe(true);

    const publicRes = await request.get("/api/catalog/categories");
    const publicBody = await publicRes.json();
    expect(findInTree(publicBody.categories, category.id)).toBe(false);

    const activateRes = await request.post(
      `/api/admin/catalog/categories/${category.id}/activate`,
    );
    expect(activateRes.status()).toBe(200);
  });

  test("admin brand management: create, update, admin-list includes inactive brands", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("brand-admin");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Brand Admin" },
    });
    await makeSuperAdmin(adminEmail);
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });

    const createRes = await request.post("/api/admin/catalog/brands", {
      data: { name: uniqueName("Brand") },
    });
    expect(createRes.status()).toBe(201);
    const { brand } = await createRes.json();

    const updateRes = await request.patch(
      `/api/admin/catalog/brands/${brand.id}`,
      { data: { logoUrl: "https://cdn.example.test/logo.png" } },
    );
    expect(updateRes.status()).toBe(200);

    const deactivateRes = await request.post(
      `/api/admin/catalog/brands/${brand.id}/deactivate`,
    );
    expect(deactivateRes.status()).toBe(200);

    // The new admin GET route (publicOnly=false) this phase added.
    const adminBrandsRes = await request.get("/api/admin/catalog/brands");
    expect(adminBrandsRes.status()).toBe(200);
    const { brands } = await adminBrandsRes.json();
    expect(brands.some((b: { id: string }) => b.id === brand.id)).toBe(true);

    const publicBrandsRes = await request.get("/api/catalog/brands");
    const { brands: publicBrands } = await publicBrandsRes.json();
    expect(publicBrands.some((b: { id: string }) => b.id === brand.id)).toBe(
      false,
    );

    const reactivateRes = await request.post(
      `/api/admin/catalog/brands/${brand.id}/activate`,
    );
    expect(reactivateRes.status()).toBe(200);
  });
});

test.describe("admin: inventory restock/adjustment/return", () => {
  test("an admin restocks, adjusts, and returns inventory, reflected in the admin list", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("inventory-admin");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Inventory Admin" },
    });
    await makeSuperAdmin(adminEmail);
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });

    const categoryRes = await request.post("/api/admin/catalog/categories", {
      data: { name: uniqueName("Category"), isActive: true },
    });
    const { category } = await categoryRes.json();
    const productRes = await request.post("/api/admin/catalog/products", {
      data: {
        name: uniqueName("Product"),
        unitOfMeasure: "EACH",
        categoryId: category.id,
        isFeatured: false,
        variant: { sku: `PHASE10-INV-${Date.now()}`, priceMinor: 100_000 },
      },
    });
    const { product } = await productRes.json();
    const variantId = product.variants[0].id;

    const restockRes = await request.post(
      `/api/admin/inventory/${variantId}/restock`,
      { data: { quantity: 10 } },
    );
    expect(restockRes.status()).toBe(201);

    const adjustRes = await request.post(
      `/api/admin/inventory/${variantId}/adjust`,
      { data: { delta: -2, note: "Phase 10 e2e stocktake" } },
    );
    expect(adjustRes.status()).toBe(201);

    const returnRes = await request.post(
      `/api/admin/inventory/${variantId}/return`,
      { data: { quantity: 1 } },
    );
    expect(returnRes.status()).toBe(201);

    const balanceRes = await request.get(`/api/admin/inventory/${variantId}`);
    const { inventory } = await balanceRes.json();
    expect(inventory.quantityOnHand).toBe(9); // 10 - 2 + 1

    const listRes = await request.get("/api/admin/inventory");
    expect(listRes.status()).toBe(200);
    const { items } = await listRes.json();
    expect(
      items.some(
        (i: { productVariantId: string }) =>
          i.productVariantId === String(variantId),
      ),
    ).toBe(true);
  });
});

test.describe("admin: order list, detail, and the new date/search filters", () => {
  test("an admin lists orders with the new orderNumber/customerEmail filters, reads detail, and cancels", async ({
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
    const { category } = await categoryRes.json();
    const productRes = await request.post("/api/admin/catalog/products", {
      data: {
        name: uniqueName("Product"),
        unitOfMeasure: "EACH",
        categoryId: category.id,
        isFeatured: false,
        variant: { sku: `PHASE10-ORD-${Date.now()}`, priceMinor: 200_000 },
      },
    });
    const { product } = await productRes.json();
    const variantId = product.variants[0].id;
    await request.post(`/api/admin/inventory/${variantId}/restock`, {
      data: { quantity: 5 },
    });

    const customerEmail = uniqueEmail("order-customer");
    await request.post("/api/auth/sign-up/email", {
      data: { email: customerEmail, password: PASSWORD, name: "Customer" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });
    const addCartRes = await request.post("/api/cart/items", {
      data: { variantId, quantity: 1 },
    });
    expect(addCartRes.status()).toBe(201);
    const createOrderRes = await request.post("/api/checkout", {
      data: { shippingAddress },
    });
    expect(createOrderRes.status()).toBe(201);
    const { order } = await createOrderRes.json();

    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });

    // The new orderNumber filter (docs/PHASE_10_ADMIN_PLAN.md §12/§28.5).
    const byNumberRes = await request.get(
      `/api/admin/orders?orderNumber=${encodeURIComponent(order.orderNumber)}`,
    );
    expect(byNumberRes.status()).toBe(200);
    const { items: byNumberItems } = await byNumberRes.json();
    expect(byNumberItems.some((o: { id: string }) => o.id === order.id)).toBe(
      true,
    );

    // The new customerEmail filter, via the registered-user relation path.
    const byEmailRes = await request.get(
      `/api/admin/orders?customerEmail=${encodeURIComponent(customerEmail)}`,
    );
    expect(byEmailRes.status()).toBe(200);
    const { items: byEmailItems } = await byEmailRes.json();
    expect(byEmailItems.some((o: { id: string }) => o.id === order.id)).toBe(
      true,
    );

    // The new date-range filter, a window that must exclude this order.
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const outOfWindowRes = await request.get(
      `/api/admin/orders?dateFrom=${encodeURIComponent(farFuture)}`,
    );
    const { items: outOfWindowItems } = await outOfWindowRes.json();
    expect(
      outOfWindowItems.some((o: { id: string }) => o.id === order.id),
    ).toBe(false);

    const detailRes = await request.get(`/api/admin/orders/${order.id}`);
    expect(detailRes.status()).toBe(200);

    const cancelRes = await request.post(`/api/orders/${order.id}/cancel`, {
      data: {},
    });
    expect(cancelRes.status()).toBe(200);
    const { order: cancelled } = await cancelRes.json();
    expect(cancelled.status).toBe("CANCELLED");
  });
});

test.describe("admin: payment reconciliation and the new refund queue", () => {
  test("an admin reads the reconciliation overview and the admin-wide refund queue; a customer is rejected from both", async ({
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

    const reconciliationRes = await request.get(
      "/api/admin/payments/reconciliation",
    );
    expect(reconciliationRes.status()).toBe(200);
    const { flags } = await reconciliationRes.json();
    expect(flags).toHaveProperty("stuckRefundIds");

    // The new admin-wide refund queue route this phase added
    // (docs/PHASE_10_ADMIN_PLAN.md §14/§28.6).
    const refundQueueRes = await request.get("/api/admin/payments/refunds");
    expect(refundQueueRes.status()).toBe(200);
    const page = await refundQueueRes.json();
    expect(page).toHaveProperty("items");
    expect(page).toHaveProperty("nextCursor");

    const customerEmail = uniqueEmail("payment-customer");
    await request.post("/api/auth/sign-up/email", {
      data: { email: customerEmail, password: PASSWORD, name: "Customer" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });

    const forbiddenReconciliationRes = await request.get(
      "/api/admin/payments/reconciliation",
    );
    expect(forbiddenReconciliationRes.status()).toBe(403);

    const forbiddenRefundQueueRes = await request.get(
      "/api/admin/payments/refunds",
    );
    expect(forbiddenRefundQueueRes.status()).toBe(403);
  });

  test("refund request/cancel remain payments.refund-gated through the new admin UI's action routes", async ({
    request,
  }) => {
    const customerEmail = uniqueEmail("refund-customer");
    await request.post("/api/auth/sign-up/email", {
      data: { email: customerEmail, password: PASSWORD, name: "Customer" },
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
  });
});

test.describe("admin: customer detail and role management", () => {
  test("a super_admin views a customer's profile and assigns then removes a role", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("customer-admin");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Customer Admin" },
    });
    await makeSuperAdmin(adminEmail);
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });

    const targetEmail = uniqueEmail("target-customer");
    await request.post("/api/auth/sign-up/email", {
      data: { email: targetEmail, password: PASSWORD, name: "Target Customer" },
    });
    const db = new PrismaClient();
    const target = await db.user.findUniqueOrThrow({
      where: { email: targetEmail },
    });
    await db.$disconnect();

    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });

    const detailPageRes = await request.get(`/admin/customers/${target.id}`);
    expect(detailPageRes.status()).toBe(200);
    const body = await detailPageRes.text();
    expect(body).toContain(targetEmail);

    const profileRes = await request.get(`/api/users/${target.id}`);
    expect(profileRes.status()).toBe(200);

    const assignRes = await request.post(
      `/api/admin/users/${target.id}/roles`,
      { data: { roleName: "staff" } },
    );
    expect(assignRes.status()).toBe(200);
    expect(await findUserRoleNames(targetEmail)).toContain("staff");

    const removeRes = await request.delete(
      `/api/admin/users/${target.id}/roles`,
      { data: { roleName: "staff" } },
    );
    expect(removeRes.status()).toBe(200);
    expect(await findUserRoleNames(targetEmail)).not.toContain("staff");
  });
});
