import { randomUUID } from "node:crypto";
import type { AuditLogActorType, User } from "@prisma/client";

import { db } from "@/lib/db";
import { ROLE_CUSTOMER } from "@/src/modules/auth/constants";

export async function findUserByEmail(email: string): Promise<User | null> {
  return db.user.findUnique({ where: { email } });
}

export async function findUserById(id: bigint): Promise<User | null> {
  return db.user.findUnique({ where: { id } });
}

export interface AdminUserRow {
  id: bigint;
  name: string;
  email: string;
  status: "ACTIVE" | "SUSPENDED";
  emailVerified: boolean;
  createdAt: Date;
  roles: string[];
}

export async function findUserForAdmin(
  id: bigint,
): Promise<AdminUserRow | null> {
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      emailVerified: true,
      createdAt: true,
      deletedAt: true,
      userRoles: { select: { role: { select: { name: true } } } },
    },
  });
  if (!user || user.deletedAt) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    roles: user.userRoles.map((entry) => entry.role.name),
  };
}

/**
 * Test/bootstrap-only identity primitive. Runtime registration and credential
 * lifecycle are owned exclusively by Better Auth. Seed/integration setup can
 * create a known credential account without depending on an HTTP server.
 */
export async function createUserWithCustomerRole(params: {
  email: string;
  passwordHash: string;
  name: string;
}): Promise<User> {
  return db.$transaction(async (tx) => {
    const customerRole = await tx.role.findUnique({
      where: { name: ROLE_CUSTOMER },
    });
    if (!customerRole) {
      throw new Error(
        `Cannot create user: role "${ROLE_CUSTOMER}" is not seeded.`,
      );
    }

    const user = await tx.user.create({
      data: {
        email: params.email,
        name: params.name,
        emailVerified: false,
      },
    });
    await tx.account.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        accountId: user.id.toString(),
        providerId: "credential",
        password: params.passwordHash,
      },
    });
    await tx.userRole.create({
      data: {
        userId: user.id,
        roleId: customerRole.id,
        assignedBy: null,
      },
    });
    return user;
  });
}

/**
 * Better Auth owns session creation and validation. Cross-user revocation is a
 * Watplux admin operation, so this is intentionally the only session mutation
 * primitive retained in the domain repository.
 */
export async function deleteAllSessionsForUser(userId: bigint): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}

export async function setUserImage(params: {
  userId: bigint;
  image: string | null;
  auditAction: "auth.avatar.updated" | "auth.avatar.removed";
}): Promise<string | null> {
  return db.$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({
      where: { id: params.userId },
      select: { image: true },
    });
    await tx.user.update({
      where: { id: params.userId },
      data: { image: params.image },
    });
    await tx.auditLog.create({
      data: {
        actorId: params.userId,
        actorType: "USER",
        action: params.auditAction,
        entityType: "user",
        entityId: params.userId,
      },
    });
    return current.image;
  });
}

export async function getUserPermissionKeys(userId: bigint): Promise<string[]> {
  const userRoles = await db.userRole.findMany({
    where: { userId },
    include: {
      role: { include: { rolePermissions: { include: { permission: true } } } },
    },
  });
  const keys = new Set<string>();
  for (const userRole of userRoles)
    for (const rp of userRole.role.rolePermissions) keys.add(rp.permission.key);
  return [...keys];
}

// ---------------------------------------------------------------------------
// Roles (admin assignment)
// ---------------------------------------------------------------------------

export async function findRoleByName(name: string) {
  return db.role.findUnique({ where: { name } });
}

export async function assignRoleToUser(params: {
  userId: bigint;
  roleId: bigint;
  assignedBy: bigint;
}): Promise<void> {
  await db.userRole.upsert({
    where: { userId_roleId: { userId: params.userId, roleId: params.roleId } },
    create: {
      userId: params.userId,
      roleId: params.roleId,
      assignedBy: params.assignedBy,
    },
    update: {},
  });
}

export async function removeRoleFromUser(params: {
  userId: bigint;
  roleId: bigint;
}): Promise<void> {
  await db.userRole.deleteMany({
    where: { userId: params.userId, roleId: params.roleId },
  });
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function writeAuditLog(params: {
  actorId: bigint | null;
  actorType: AuditLogActorType;
  action: string;
  entityType: string;
  entityId: bigint;
  ipAddress?: string | null;
}): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: params.actorId,
      actorType: params.actorType,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      ipAddress: params.ipAddress ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Admin dashboard metrics (docs/PHASE_10_ADMIN_PLAN.md §9) — read-only.
// ---------------------------------------------------------------------------

export interface CustomerMetrics {
  activeCustomers: number;
  newCustomers: number;
}

/** `newCustomersSince` is computed and passed in by the caller (never
 * `NOW() - INTERVAL` in raw SQL — this codebase's own established
 * clock-skew-avoidance convention, docs/PHASE_8_PAYMENT_PAYSTACK_IMPLEMENTATION.md
 * §17 bug 5), so both counts are ordinary, indexed Prisma queries. */
export async function getCustomerMetrics(
  newCustomersSince: Date,
): Promise<CustomerMetrics> {
  const [activeCustomers, newCustomers] = await Promise.all([
    db.user.count({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        userRoles: { some: { role: { name: ROLE_CUSTOMER } } },
      },
    }),
    db.user.count({
      where: {
        deletedAt: null,
        userRoles: { some: { role: { name: ROLE_CUSTOMER } } },
        createdAt: { gte: newCustomersSince },
      },
    }),
  ]);

  return { activeCustomers, newCustomers };
}

// ---------------------------------------------------------------------------
// Admin customer management — additive Better Auth-era operations.
// ---------------------------------------------------------------------------

export async function listUsersForAdmin(params: {
  limit: number;
  cursorId?: bigint;
  search?: string;
  status?: "ACTIVE" | "SUSPENDED";
}): Promise<{ rows: AdminUserRow[]; nextCursorId: bigint | null }> {
  const rows = await db.user.findMany({
    where: {
      deletedAt: null,
      ...(params.cursorId ? { id: { lt: params.cursorId } } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? {
            OR: [
              { email: { contains: params.search } },
              { name: { contains: params.search } },
            ],
          }
        : {}),
    },
    orderBy: { id: "desc" },
    take: params.limit + 1,
    include: { userRoles: { include: { role: { select: { name: true } } } } },
  });
  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  return {
    rows: page.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      roles: user.userRoles.map((entry) => entry.role.name),
    })),
    nextCursorId: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function setUserStatus(
  userId: bigint,
  status: "ACTIVE" | "SUSPENDED",
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status } });
    if (status === "SUSPENDED") {
      await tx.session.deleteMany({ where: { userId } });
    }
  });
}
