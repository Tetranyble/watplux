import type { PrismaClient } from "@prisma/client";

/**
 * The actual RBAC seeding logic, extracted so it can be called both by the
 * `prisma db seed` CLI entry point (prisma/seed.ts) and by the integration
 * test setup (tests/integration/setup.ts) — guaranteeing tests always have
 * the roles/permissions they need regardless of whether the seed script was
 * run manually first. Idempotent (safe to call repeatedly).
 */

export const PERMISSIONS = [
  "products.read",
  "products.create",
  "products.update",
  "products.delete",
  "inventory.read",
  "inventory.adjust",
  "orders.read",
  "orders.update",
  "payments.read",
  "payments.refund",
  "consultations.read",
  "consultations.update",
  "settings.manage",
  "users.manage",
] as const;

export const STAFF_PERMISSIONS = [
  "products.read",
  "inventory.read",
  "orders.read",
  "orders.update",
  "payments.read",
  "consultations.read",
  "consultations.update",
];

export async function seedRbacData(db: PrismaClient): Promise<void> {
  for (const key of PERMISSIONS) {
    await db.permission.upsert({
      where: { key },
      create: { key },
      update: {},
    });
  }

  const staffRole = await db.role.upsert({
    where: { name: "staff" },
    create: {
      name: "staff",
      description: "Read-heavy admin access plus order/consultation updates.",
    },
    update: {},
  });
  const superAdminRole = await db.role.upsert({
    where: { name: "super_admin" },
    create: { name: "super_admin", description: "Full administrative access." },
    update: {},
  });
  await db.role.upsert({
    where: { name: "customer" },
    create: {
      name: "customer",
      description:
        "Authenticated storefront customer — no elevated permissions.",
    },
    update: {},
  });

  const allPermissions = await db.permission.findMany();
  const permissionByKey = new Map(allPermissions.map((p) => [p.key, p]));

  for (const key of STAFF_PERMISSIONS) {
    const permission = permissionByKey.get(key);
    if (!permission) continue;
    await db.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: staffRole.id,
          permissionId: permission.id,
        },
      },
      create: { roleId: staffRole.id, permissionId: permission.id },
      update: {},
    });
  }

  for (const permission of allPermissions) {
    await db.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: superAdminRole.id,
          permissionId: permission.id,
        },
      },
      create: { roleId: superAdminRole.id, permissionId: permission.id },
      update: {},
    });
  }
}
