import { PrismaClient } from "@prisma/client";
import type { APIRequestContext } from "@playwright/test";

const PASSWORD = "Sup3rSecretPassword";

export function phase16Email(label: string): string {
  return `phase16-browser-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

export function phase16Name(label: string): string {
  return `Phase16Browser ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function phase16Sku(): string {
  return `PHASE16-SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function promoteToSuperAdmin(email: string): Promise<void> {
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

export async function createPublishedProduct(
  request: APIRequestContext,
  options: { quantity?: number; priceMinor?: number } = {},
) {
  const adminEmail = phase16Email("seed-admin");
  await request.post("/api/auth/sign-up/email", {
    data: {
      email: adminEmail,
      password: PASSWORD,
      name: "Phase 16 Seed Admin",
    },
  });
  await promoteToSuperAdmin(adminEmail);
  await request.post("/api/auth/sign-in/email", {
    data: { email: adminEmail, password: PASSWORD },
  });

  const categoryResponse = await request.post("/api/admin/catalog/categories", {
    data: { name: phase16Name("Category"), isActive: true },
  });
  if (!categoryResponse.ok()) {
    throw new Error(
      `Could not create Phase 16 category: ${categoryResponse.status()}`,
    );
  }
  const { category } = await categoryResponse.json();

  const productResponse = await request.post("/api/admin/catalog/products", {
    data: {
      name: phase16Name("Product"),
      unitOfMeasure: "EACH",
      categoryId: category.id,
      isFeatured: true,
      variant: {
        sku: phase16Sku(),
        priceMinor: options.priceMinor ?? 450_000,
        powerRatingW: 5000,
        voltageV: 48,
      },
    },
  });
  if (!productResponse.ok()) {
    throw new Error(
      `Could not create Phase 16 product: ${productResponse.status()}`,
    );
  }
  const { product } = await productResponse.json();
  const variantId = product.variants[0].id;

  await request.post(`/api/admin/catalog/products/${product.id}/publish`, {
    data: {},
  });
  await request.post(`/api/admin/inventory/${variantId}/restock`, {
    data: { quantity: options.quantity ?? 5 },
  });
  await request.post("/api/auth/sign-out", { data: {} });

  return { product, category, variantId };
}

export { PASSWORD };
