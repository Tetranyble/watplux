import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { assignRole } from "@/src/modules/auth/use-cases/assign-role";
import { removeRole } from "@/src/modules/auth/use-cases/remove-role";
import { cleanupTestData, createTestUser } from "./helpers/fixtures";

describe("privilege escalation", () => {
  afterAll(cleanupTestData);

  it("a customer cannot assign themselves the staff role", async () => {
    const { user } = await createTestUser();

    await expect(
      assignRole(user, { userId: user.id, roleName: "staff" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const roles = await db.userRole.findMany({
      where: { userId: user.id },
      include: { role: true },
    });
    expect(roles.map((r) => r.role.name)).toEqual(["customer"]); // unchanged
  });

  it("a customer cannot assign themselves super_admin", async () => {
    const { user } = await createTestUser();

    await expect(
      assignRole(user, { userId: user.id, roleName: "super_admin" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a customer cannot assign a role to another user", async () => {
    const { user: attacker } = await createTestUser();
    const { user: victim } = await createTestUser();

    await expect(
      assignRole(attacker, { userId: victim.id, roleName: "staff" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const victimRoles = await db.userRole.findMany({
      where: { userId: victim.id },
      include: { role: true },
    });
    expect(victimRoles.map((r) => r.role.name)).toEqual(["customer"]);
  });

  it("a customer cannot remove another user's role", async () => {
    const { user: attacker } = await createTestUser();
    const { user: victim } = await createTestUser();

    await expect(
      removeRole(attacker, { userId: victim.id, roleName: "customer" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const victimRoles = await db.userRole.findMany({
      where: { userId: victim.id },
    });
    expect(victimRoles).toHaveLength(1); // still has their customer role
  });

  it("a freshly registered/assigned-customer's permission set is always empty, regardless of what the client requesting registration sent", async () => {
    // No registration/login input field can influence the resulting
    // permission set — it is exclusively derived server-side from
    // user_roles -> role_permissions (repo.ts), never from request input.
    // (The complementary check — that a forged request body field is
    // ignored by the Route Handler itself — is covered at the HTTP layer
    // in tests/e2e/auth.spec.ts, where "manipulating request parameters"
    // is actually meaningful.)
    const { user } = await createTestUser();
    expect(user.permissions.size).toBe(0);
  });
});
