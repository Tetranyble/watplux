import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { assignRole } from "@/src/modules/auth/use-cases/assign-role";
import {
  hasPermission,
  requirePermission,
} from "@/src/modules/auth/use-cases/permissions";
import {
  assignSeededRole,
  cleanupTestData,
  createTestUser,
  resolveTestUser,
} from "./helpers/fixtures";

/** Permissions are resolved from persisted role assignments. After changing a
 * user's role mid-test, rebuild the actor projection rather than reusing the
 * stale in-memory `AuthenticatedUser`. Production does the same on each
 * Better Auth-backed request through `lib/session.ts`. */
async function reresolveAfterRoleChange(email: string) {
  const { user } = await resolveTestUser(email);
  return user;
}

describe("RBAC authorization", () => {
  afterAll(cleanupTestData);

  it("denies a customer an admin-only permission", async () => {
    const { user } = await createTestUser();
    expect(hasPermission(user, "users.manage")).toBe(false);
    expect(() => requirePermission(user, "users.manage")).toThrow();
  });

  it("a plain customer resolves with zero admin permissions by design", async () => {
    const { user } = await createTestUser();
    expect(user.permissions.size).toBe(0);
  });

  it("allows staff a permission they were seeded with, denies one they weren't", async () => {
    const { email, user } = await createTestUser();
    await assignSeededRole(user.id, "staff");
    const staffUser = await reresolveAfterRoleChange(email);

    expect(hasPermission(staffUser, "orders.read")).toBe(true);
    expect(hasPermission(staffUser, "settings.manage")).toBe(false);
    expect(() => requirePermission(staffUser, "settings.manage")).toThrow();
  });

  it("allows super_admin a privileged action end-to-end", async () => {
    const { email, user } = await createTestUser();
    await assignSeededRole(user.id, "super_admin");
    const superAdmin = await reresolveAfterRoleChange(email);

    expect(hasPermission(superAdmin, "users.manage")).toBe(true);
    expect(hasPermission(superAdmin, "settings.manage")).toBe(true);

    const { user: target } = await createTestUser();
    await expect(
      assignRole(superAdmin, { userId: target.id, roleName: "staff" }),
    ).resolves.toBeUndefined();

    const targetRoles = await db.userRole.findMany({
      where: { userId: target.id },
      include: { role: true },
    });
    expect(targetRoles.map((r) => r.role.name)).toContain("staff");
  });
});
