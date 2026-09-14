import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  assignSeededRole,
  cleanupTestData,
  createPersistedTestSession,
  createTestUser,
  resolveTestUser,
} from "@/tests/integration/helpers/fixtures";
import { forceLogoutUser } from "@/src/modules/auth/use-cases/force-logout-user";
import { getUserForAdmin } from "@/src/modules/auth/use-cases/get-user-for-admin";
import { listUsersForAdmin } from "@/src/modules/auth/use-cases/list-users-for-admin";
import { setUserStatus } from "@/src/modules/auth/use-cases/set-user-status";
import { ForbiddenError } from "@/lib/errors";

describe("admin customer management", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  async function superAdminActor() {
    const account = await createTestUser({ name: "Operations Admin" });
    await assignSeededRole(account.user.id, "super_admin");
    return (await resolveTestUser(account.email)).user;
  }

  it("lists safe customer projections for users.manage actors", async () => {
    const actor = await superAdminActor();
    const target = await createTestUser({ name: "Customer One" });

    const page = await listUsersForAdmin(actor, {
      limit: 25,
      search: target.email,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: target.user.id.toString(),
      email: target.email,
      status: "ACTIVE",
    });
    expect(JSON.stringify(page.items[0])).not.toContain("password");
    expect(JSON.stringify(page.items[0])).not.toContain("sessionToken");
  });

  it("rejects customer access to the admin customer list", async () => {
    const customer = await createTestUser();
    await expect(
      listUsersForAdmin(customer.user, { limit: 25 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("suspends an account and immediately removes all sessions", async () => {
    const actor = await superAdminActor();
    const target = await createTestUser();
    await createPersistedTestSession(target.user.id);

    expect(
      await db.session.count({ where: { userId: target.user.id } }),
    ).toBeGreaterThan(0);
    await setUserStatus(actor, target.user.id, "SUSPENDED");

    const stored = await db.user.findUniqueOrThrow({
      where: { id: target.user.id },
    });
    expect(stored.status).toBe("SUSPENDED");
    expect(await db.session.count({ where: { userId: target.user.id } })).toBe(
      0,
    );
  });

  it("prevents an administrator from suspending their own account", async () => {
    const actor = await superAdminActor();
    await expect(
      setUserStatus(actor, actor.id, "SUSPENDED"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("force logout removes target sessions without changing account status", async () => {
    const actor = await superAdminActor();
    const target = await createTestUser();
    await createPersistedTestSession(target.user.id);

    await forceLogoutUser(actor, target.user.id);
    expect(await db.session.count({ where: { userId: target.user.id } })).toBe(
      0,
    );
    expect((await getUserForAdmin(actor, target.user.id)).status).toBe(
      "ACTIVE",
    );
  });
});
