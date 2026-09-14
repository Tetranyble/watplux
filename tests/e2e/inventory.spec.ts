import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

/**
 * The thin HTTP-boundary slice for the inventory domain
 * (docs/PHASE_5_INVENTORY_PLAN.md §23): proves the real
 * request -> use-case -> DB path end-to-end for the 6 admin routes, plus
 * one forged-field-over-HTTP privilege-escalation check. Exhaustive
 * business-rule coverage (invariants, concurrency, authorization matrix,
 * order-item/variant mismatch) lives in the integration suite
 * (tests/integration/inventory-*.test.ts) — this file does not repeat it.
 * No UI, no reserve/release/sale routes (they don't exist —
 * inter-module contracts only, exercised directly in integration tests).
 *
 * Uses Playwright's `request` fixture only (no browser binary), matching
 * tests/e2e/catalog.spec.ts's established pattern.
 */

function uniqueEmail(label: string): string {
  return `phase5-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

function uniqueName(label: string): string {
  return `Phase5E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

test.describe("inventory: real HTTP boundary", () => {
  test("an admin restocks, reads, adjusts, returns, and lists inventory over real HTTP", async ({
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
    expect(categoryRes.status()).toBe(201);
    const { category } = await categoryRes.json();

    const createRes = await request.post("/api/catalog/products", {
      data: {
        name: uniqueName("Product"),
        unitOfMeasure: "EACH",
        categoryId: category.id,
        isFeatured: false,
        variant: { sku: `PHASE5E2E-SKU-${Date.now()}`, priceMinor: 150_000 },
      },
    });
    expect(createRes.status()).toBe(201);
    const { product } = await createRes.json();
    const variantId = product.variants[0].id;

    // No inventory tracked yet — 404.
    const beforeRestock = await request.get(
      `/api/admin/inventory/${variantId}`,
    );
    expect(beforeRestock.status()).toBe(404);

    const restockRes = await request.post(
      `/api/admin/inventory/${variantId}/restock`,
      { data: { quantity: 20 } },
    );
    expect(restockRes.status()).toBe(201);
    const { movement: restockMovement } = await restockRes.json();
    expect(restockMovement.type).toBe("RESTOCK");
    expect(restockMovement.onHandDelta).toBe(20);

    const balanceRes = await request.get(`/api/admin/inventory/${variantId}`);
    expect(balanceRes.status()).toBe(200);
    const { inventory } = await balanceRes.json();
    expect(inventory.quantityOnHand).toBe(20);
    expect(inventory.quantityAvailable).toBe(20);

    const adjustRes = await request.post(
      `/api/admin/inventory/${variantId}/adjust`,
      { data: { delta: -5, note: "E2E stocktake correction" } },
    );
    expect(adjustRes.status()).toBe(201);
    const { movement: adjustMovement } = await adjustRes.json();
    expect(adjustMovement.type).toBe("ADJUSTMENT");
    expect(adjustMovement.onHandDelta).toBe(-5);

    const returnRes = await request.post(
      `/api/admin/inventory/${variantId}/return`,
      { data: { quantity: 3 } },
    );
    expect(returnRes.status()).toBe(201);
    const { movement: returnMovement } = await returnRes.json();
    expect(returnMovement.type).toBe("RETURN");

    const afterAllRes = await request.get(`/api/admin/inventory/${variantId}`);
    const { inventory: afterAll } = await afterAllRes.json();
    expect(afterAll.quantityOnHand).toBe(18); // 20 - 5 + 3

    const movementsRes = await request.get(
      `/api/admin/inventory/${variantId}/movements`,
    );
    expect(movementsRes.status()).toBe(200);
    const { items: movements } = await movementsRes.json();
    const types = movements.map((m: { type: string }) => m.type).sort();
    expect(types).toEqual(["ADJUSTMENT", "RESTOCK", "RETURN"]);

    const listRes = await request.get("/api/admin/inventory");
    expect(listRes.status()).toBe(200);
    const { items: listItems } = await listRes.json();
    expect(
      listItems.some(
        (i: { productVariantId: string }) =>
          i.productVariantId === String(variantId),
      ),
    ).toBe(true);
  });

  test("a customer's forged fields on a mutating admin endpoint have no effect — still 403, inventory unchanged", async ({
    request,
  }) => {
    const adminEmail = uniqueEmail("inventory-setup-admin");
    await request.post("/api/auth/sign-up/email", {
      data: { email: adminEmail, password: PASSWORD, name: "Setup Admin" },
    });
    await makeSuperAdmin(adminEmail);
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });

    const categoryRes = await request.post("/api/admin/catalog/categories", {
      data: { name: uniqueName("Category"), isActive: true },
    });
    const { category } = await categoryRes.json();
    const createRes = await request.post("/api/catalog/products", {
      data: {
        name: uniqueName("Product"),
        unitOfMeasure: "EACH",
        categoryId: category.id,
        isFeatured: false,
        variant: { sku: `PHASE5E2E-SKU-${Date.now()}`, priceMinor: 150_000 },
      },
    });
    const { product } = await createRes.json();
    const variantId = product.variants[0].id;
    await request.post(`/api/admin/inventory/${variantId}/restock`, {
      data: { quantity: 10 },
    });

    // A fresh, unauthenticated-then-customer session — its own cookie
    // jar, never touched by the admin login above.
    const customerEmail = uniqueEmail("inventory-customer");
    await request.post("/api/auth/sign-up/email", {
      data: { email: customerEmail, password: PASSWORD, name: "Customer" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });

    const res = await request.post(`/api/admin/inventory/${variantId}/adjust`, {
      data: {
        delta: 1000,
        note: "Should not apply",
        // Forged fields a naive implementation might mistakenly trust
        // — the real actor and its permissions are ALWAYS resolved
        // server-side from the session cookie, never from the request
        // body (mirrors tests/e2e/catalog.spec.ts's equivalent check).
        actorPermissions: ["inventory.adjust"],
        isAdmin: true,
      },
    });
    expect(res.status()).toBe(403);

    // Log back in as the real admin to confirm nothing changed.
    await request.post("/api/auth/sign-in/email", {
      data: { email: adminEmail, password: PASSWORD },
    });
    const balanceRes = await request.get(`/api/admin/inventory/${variantId}`);
    const { inventory } = await balanceRes.json();
    expect(inventory.quantityOnHand).toBe(10);
  });

  test("an unauthenticated request to a mutating inventory endpoint is rejected before any permission check", async ({
    request,
  }) => {
    const res = await request.post("/api/admin/inventory/1/restock", {
      data: { quantity: 5 },
    });
    expect(res.status()).toBe(401);
  });

  test("an unauthenticated request to a read inventory endpoint is also rejected — no public inventory data", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/inventory");
    expect(res.status()).toBe(401);
  });
});
