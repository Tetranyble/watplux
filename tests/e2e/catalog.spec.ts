import { PrismaClient } from "@prisma/client";
import { expect, request as playwrightRequest, test } from "@playwright/test";

/**
 * The thin HTTP-boundary slice for the catalog domain
 * (docs/PHASE_4_CATALOG_PLAN.md §15): proves the real
 * request -> use-case -> DB -> public-read path end-to-end, plus one
 * forged-field-over-HTTP privilege-escalation check on a mutating
 * catalog endpoint. Exhaustive business-rule coverage (invariants,
 * concurrency, authorization matrix) lives in the integration suite
 * (tests/integration/catalog-*.test.ts) — this file does not repeat it.
 *
 * Uses Playwright's `request` fixture only (no browser binary), matching
 * tests/e2e/auth.spec.ts's established pattern.
 *
 * Elevating a freshly-registered test user to `super_admin` requires a
 * direct database write — the public API has no self-service way to gain
 * admin permissions (by design). A standalone `PrismaClient` is used for
 * this, same technique as `global-teardown.ts`, for the same reason
 * (Playwright's loader doesn't resolve the `@/*` alias `lib/db.ts` needs).
 */

function uniqueEmail(label: string): string {
  return `phase4-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

function uniqueName(label: string): string {
  return `Phase4E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PASSWORD = "Sup3rSecretPassword";

// Matches playwright.config.ts's `use.baseURL` — see tests/e2e/auth.spec.ts's
// identical constant/rationale for why a separate `request.newContext()`
// (its own cookie jar) is used for the "genuinely anonymous" reads below,
// rather than trying to override the shared `request` fixture's
// already-authenticated cookie jar.
const BASE_URL = "http://localhost:3000";

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

test.describe("catalog: real HTTP boundary", () => {
  test("an admin creates and publishes a product over HTTP; an anonymous request reads it back via the public listing", async ({
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

    const productName = uniqueName("Product");
    const createRes = await request.post("/api/catalog/products", {
      data: {
        name: productName,
        unitOfMeasure: "EACH",
        categoryId: category.id,
        isFeatured: false,
        variant: {
          sku: `PHASE4E2E-SKU-${Date.now()}`,
          priceMinor: 250_000,
        },
      },
    });
    expect(createRes.status()).toBe(201);
    const { product } = await createRes.json();
    expect(product.status).toBe("DRAFT");

    // Not yet published — the public endpoint must not show it.
    const beforePublish = await request.get(
      `/api/catalog/products/${product.slug}`,
    );
    expect(beforePublish.status()).toBe(404);

    const publishRes = await request.post(
      `/api/admin/catalog/products/${product.id}/publish`,
    );
    expect(publishRes.status()).toBe(200);

    // A brand-new, unauthenticated context (its own cookie jar, never
    // touched by the admin login above) — proving this is a genuinely
    // public read, not just "this session happens to also work
    // anonymously."
    const anonymous = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const anonymousRead = await anonymous.get(
        `/api/catalog/products/${product.slug}`,
      );
      expect(anonymousRead.status()).toBe(200);
      const { product: publicProduct } = await anonymousRead.json();
      expect(publicProduct.name).toBe(productName);
      expect(publicProduct.status).toBe("ACTIVE");

      const listRes = await anonymous.get("/api/catalog/products");
      expect(listRes.status()).toBe(200);
      const { items } = await listRes.json();
      expect(items.some((p: { slug: string }) => p.slug === product.slug)).toBe(
        true,
      );
    } finally {
      await anonymous.dispose();
    }
  });

  test("a customer's forged fields on a mutating admin endpoint have no effect — still 403", async ({
    request,
  }) => {
    const customerEmail = uniqueEmail("catalog-customer");
    await request.post("/api/auth/sign-up/email", {
      data: { email: customerEmail, password: PASSWORD, name: "Customer" },
    });
    await request.post("/api/auth/sign-in/email", {
      data: { email: customerEmail, password: PASSWORD },
    });

    const res = await request.post("/api/admin/catalog/categories", {
      data: {
        name: uniqueName("ShouldNotExist"),
        isActive: true,
        // Forged fields a naive implementation might mistakenly trust —
        // the real actor and its permissions are ALWAYS resolved
        // server-side from the session cookie, never from the request
        // body (mirrors tests/e2e/auth.spec.ts's equivalent check).
        actorPermissions: ["products.create", "products.update"],
        isAdmin: true,
      },
    });
    expect(res.status()).toBe(403);

    const createdAnyway = await request.get("/api/catalog/categories");
    const { categories } = await createdAnyway.json();
    const leaked = JSON.stringify(categories).includes("ShouldNotExist");
    expect(leaked).toBe(false);
  });

  test("an unauthenticated request to a mutating catalog endpoint is rejected before any permission check", async ({
    request,
  }) => {
    const res = await request.post("/api/admin/catalog/brands", {
      data: { name: uniqueName("NoSession") },
    });
    expect(res.status()).toBe(401);
  });
});
