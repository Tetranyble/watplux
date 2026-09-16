import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { hashPassword } from "@/src/integrations/crypto/password";
import * as authRepo from "@/src/modules/auth/repo";
import type { AuthenticatedUser } from "@/src/modules/auth/types";

/** Every test-created email uses this prefix so cleanup can target exactly
 * (and only) test data, never anything a developer might have in a shared
 * dev database. */
const TEST_EMAIL_PREFIX = "phase3-test-";

let counter = 0;
export function uniqueTestEmail(): string {
  counter += 1;
  return `${TEST_EMAIL_PREFIX}${Date.now()}-${counter}@example.test`;
}

/** Creates a real, usable Better Auth credential account directly via the
 * test/bootstrap repository primitive. Authentication lifecycle itself is
 * covered through Better Auth's real HTTP boundary in `tests/e2e/auth.spec.ts`;
 * domain integration tests only need a persisted actor with known RBAC. */
export async function createTestUser(
  overrides: { email?: string; password?: string; name?: string } = {},
): Promise<{ email: string; password: string; user: AuthenticatedUser }> {
  const email = overrides.email ?? uniqueTestEmail();
  const password = overrides.password ?? "Sup3rSecretPassword";
  const passwordHash = await hashPassword(password);

  await authRepo.createUserWithCustomerRole({
    email,
    passwordHash,
    name: overrides.name ?? "Test User",
  });

  const persisted = await authRepo.findUserByEmail(email);
  if (!persisted) {
    throw new Error("Test setup failed: created user could not be resolved.");
  }
  const permissionKeys = await authRepo.getUserPermissionKeys(persisted.id);
  const user: AuthenticatedUser = {
    id: persisted.id,
    email: persisted.email,
    name: persisted.name,
    image: persisted.image,
    status: persisted.status,
    permissions: new Set(permissionKeys),
  };

  return { email, password, user };
}

/** Assigns an existing seeded role (staff/super_admin) to a test user. */
export async function assignSeededRole(
  userId: bigint,
  roleName: "staff" | "super_admin",
): Promise<void> {
  const role = await authRepo.findRoleByName(roleName);
  if (!role) throw new Error(`Role "${roleName}" is not seeded.`);
  await authRepo.assignRoleToUser({
    userId,
    roleId: role.id,
    assignedBy: userId,
  });
}

export async function resolveTestUser(
  email: string,
): Promise<{ user: AuthenticatedUser }> {
  const persisted = await authRepo.findUserByEmail(email);
  if (!persisted || persisted.deletedAt) {
    throw new Error("Test setup failed: user could not be resolved.");
  }
  const permissionKeys = await authRepo.getUserPermissionKeys(persisted.id);
  return {
    user: {
      id: persisted.id,
      email: persisted.email,
      name: persisted.name,
      image: persisted.image,
      status: persisted.status,
      permissions: new Set(permissionKeys),
    },
  };
}

/** Creates a Better Auth-compatible persisted session for tests whose subject
 * is Watplux session revocation, not authentication itself. Better Auth owns
 * real session issuance and that lifecycle is tested over HTTP in auth.spec. */
export async function createPersistedTestSession(
  userId: bigint,
): Promise<void> {
  await db.session.create({
    data: {
      id: randomUUID(),
      userId,
      token: `test-session-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ipAddress: "127.0.0.1",
      userAgent: "watplux-integration-test",
    },
  });
}

/** Deletes every user created by this test run (matched by the test-email
 * prefix). Better Auth sessions/accounts and user_roles cascade through their
 * User foreign keys. Better Auth `verifications` intentionally has no User FK; test users created
 * through this helper do not create verification rows. Audit rows are cleaned
 * explicitly because `entityId` is deliberately not a foreign key. */
export async function cleanupTestData(): Promise<void> {
  const testUsers = await db.user.findMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
    select: { id: true },
  });
  const testUserIds = testUsers.map((u) => u.id);

  if (testUserIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { entityType: "user", entityId: { in: testUserIds } },
    });
  }

  await db.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
}
