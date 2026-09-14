import { afterAll, describe, expect, it } from "vitest";

import { getUserProfile } from "@/src/modules/auth/use-cases/get-user-profile";
import {
  assignSeededRole,
  cleanupTestData,
  createTestUser,
  resolveTestUser,
} from "./helpers/fixtures";

describe("IDOR protection", () => {
  afterAll(cleanupTestData);

  it("a user can read their own profile", async () => {
    const { user } = await createTestUser();
    const profile = await getUserProfile(user, user.id);
    expect(profile.id).toBe(user.id.toString());
  });

  it("User A cannot access User B's protected resource", async () => {
    const { user: userA } = await createTestUser();
    const { user: userB } = await createTestUser();

    await expect(getUserProfile(userA, userB.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("manipulating the ID in the request does not bypass the check — a nonexistent ID is also denied, not silently accepted", async () => {
    const { user } = await createTestUser();
    await expect(
      getUserProfile(user, BigInt(999_999_999)),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("an admin (users.manage) CAN read any user's profile — the sanctioned elevated-permission path, not a bypass", async () => {
    const { email, user: adminSeed } = await createTestUser();
    await assignSeededRole(adminSeed.id, "super_admin");
    const { user: admin } = await resolveTestUser(email);

    const { user: someoneElse } = await createTestUser();
    const profile = await getUserProfile(admin, someoneElse.id);
    expect(profile.id).toBe(someoneElse.id.toString());
  });
});
