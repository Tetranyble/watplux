import type { PrismaClient } from "@prisma/client";

import { hashPassword } from "@/src/integrations/crypto/password";
import { checkPasswordPolicy } from "@/src/modules/auth/domain/password-policy";
import * as authRepo from "@/src/modules/auth/repo";

/**
 * Bootstrap admin account — the one piece of non-structural data this
 * project's seeding deliberately makes room for. `seedRbacData` (seed-data.ts)
 * only ever creates roles/permissions, never a `User` row, so without this
 * there is no way to reach `/admin` at all except by registering through the
 * app and then hand-writing a `user_roles` row directly against the
 * database — the same chicken-and-egg gap `tests/e2e/*.spec.ts`'s own
 * `makeSuperAdmin()` helpers exist to paper over for tests. This is that
 * same mechanism, exposed for real local/staging use via two env vars
 * instead of being copy-pasted into every script that needs an admin
 * session.
 *
 * Deliberately calls `authRepo.createUserWithCustomerRole` +
 * `authRepo.assignRoleToUser` directly rather than going through the
 * Better Auth registration / `assignRole` use-case:
 * - Better Auth registration is an HTTP/session lifecycle and is intentionally
 *   not invoked from a bootstrap script.
 * - `assignRole()` requires an already-authenticated `users.manage` actor
 *   to call it — there is no such actor yet at bootstrap time, which is
 *   exactly the gap this script closes. This mirrors the exact pattern
 *   `tests/integration/helpers/fixtures.ts`'s `createTestUser()` already
 *   established for the same reason.
 *
 * Idempotent: safe to re-run. An existing account is promoted (or
 * confirmed already promoted) rather than duplicated; its password is
 * never overwritten by a later run with a different `SEED_ADMIN_PASSWORD`
 * (Better Auth-style "email already taken" semantics) — delete the row
 * yourself first if you genuinely need to reset it.
 */
export async function seedAdminAccount(
  db: PrismaClient,
  config: { email?: string; password?: string; name: string },
): Promise<void> {
  if (!config.email || !config.password) {
    console.log(
      "Skipping bootstrap admin account — set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (see .env.example) to create one.",
    );
    return;
  }

  const policy = checkPasswordPolicy(config.password);
  if (!policy.valid) {
    throw new Error(
      `SEED_ADMIN_PASSWORD does not meet the password policy: ${policy.reasons.join(" ")}`,
    );
  }

  let user = await authRepo.findUserByEmail(config.email);
  if (user) {
    console.log(
      `Bootstrap admin account already exists (${config.email}) — leaving its password untouched, verifying its role.`,
    );
  } else {
    const passwordHash = await hashPassword(config.password);
    user = await authRepo.createUserWithCustomerRole({
      email: config.email,
      passwordHash,
      name: config.name,
    });
    console.log(`Created bootstrap admin account: ${config.email}`);
  }

  // Bootstrap accounts don't need to click an email-verification link.
  if (!user.emailVerified) {
    await db.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
  }

  const superAdminRole = await authRepo.findRoleByName("super_admin");
  if (!superAdminRole) {
    throw new Error(
      "The super_admin role doesn't exist yet — seedRbacData must run before seedAdminAccount.",
    );
  }

  // Self-assigned: no other actor exists to be `assignedBy` at bootstrap
  // time, and `assignRoleToUser`'s `assignedBy` is a required `bigint`
  // (unlike the raw `userRole.create` call `createUserWithCustomerRole`
  // makes for the initial `customer` role, which passes `assignedBy: null`
  // directly) — the account records itself as its own grantor rather than
  // bypassing this typed repo function just to pass `null` through it.
  await authRepo.assignRoleToUser({
    userId: user.id,
    roleId: superAdminRole.id,
    assignedBy: user.id,
  });

  console.log(`Granted super_admin to ${config.email}.`);
}
