import { randomUUID } from "node:crypto";

import { betterAuth } from "better-auth/minimal";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/lib/db";
import { env, requireBetterAuthSecret } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendTransactionalEmail } from "@/src/integrations/email/mailer";
import {
  passwordResetEmail,
  verificationEmail,
} from "@/src/integrations/email/templates";
import {
  hashPassword,
  verifyPassword,
} from "@/src/integrations/crypto/password";
import { ROLE_CUSTOMER } from "@/src/modules/auth/constants";
import { checkPasswordPolicy } from "@/src/modules/auth/domain/password-policy";

/**
 * Better Auth is the single authentication/session owner.
 *
 * The application keeps its existing RBAC tables (`roles`, `permissions`,
 * `user_roles`) because they express business permissions; Better Auth owns
 * identity, credential accounts, sessions and verification records.
 */
const createAuth = () =>
  betterAuth({
    appName: "Watplux",
    baseURL: env.BETTER_AUTH_URL,
    secret: requireBetterAuthSecret(),
    database: prismaAdapter(db, { provider: "mysql" }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        const message = await passwordResetEmail(user.name, url);
        await sendTransactionalEmail({
          to: user.email,
          ...message,
        });
      },
      password: {
        hash: async (password) => {
          const policy = checkPasswordPolicy(password);
          if (!policy.valid) {
            throw new APIError("BAD_REQUEST", {
              message:
                policy.reasons[0] ??
                "Password does not meet the security policy.",
            });
          }
          return hashPassword(password);
        },
        verify: ({ hash, password }) => verifyPassword(password, hash),
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        const message = await verificationEmail(user.name, url);
        await sendTransactionalEmail({
          to: user.email,
          ...message,
        });
      },
    },
    rateLimit: {
      enabled: env.NODE_ENV !== "test",
      storage: "database",
      modelName: "rateLimit",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60 * 10, max: 5 },
        "/request-password-reset": { window: 60 * 10, max: 3 },
        "/reset-password": { window: 60 * 10, max: 5 },
        "/send-verification-email": { window: 60 * 10, max: 3 },
        "/change-password": { window: 60 * 10, max: 5 },
      },
    },
    session: {
      expiresIn: env.SESSION_TTL_DAYS * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: "watplux",
      ipAddress: {
        ipAddressHeaders: [env.TRUSTED_CLIENT_IP_HEADER],
      },
      database: {
        joins: true,
        // Preserve the existing BIGINT AUTO_INCREMENT users.id so every
        // commerce-domain foreign key remains stable. Better Auth's auxiliary
        // records use UUID strings.
        generateId: ({ model }) =>
          model === "user" || model === "users" ? false : randomUUID(),
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const customerRole = await db.role.findUnique({
              where: { name: ROLE_CUSTOMER },
              select: { id: true },
            });
            if (!customerRole) {
              logger.error(
                { userId: String(user.id) },
                "Better Auth user created before customer role was seeded",
              );
              return;
            }
            await db.userRole.upsert({
              where: {
                userId_roleId: {
                  userId: BigInt(String(user.id)),
                  roleId: customerRole.id,
                },
              },
              create: {
                userId: BigInt(String(user.id)),
                roleId: customerRole.id,
                assignedBy: null,
              },
              update: {},
            });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await db.user.findUnique({
              where: { id: BigInt(String(session.userId)) },
              select: { status: true, deletedAt: true },
            });
            if (!user || user.status !== "ACTIVE" || user.deletedAt) {
              throw new APIError("UNAUTHORIZED", {
                message: "This account is not available.",
              });
            }
            return { data: session };
          },
        },
      },
    },
    plugins: [nextCookies()],
  });

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth(): ReturnType<typeof createAuth> {
  authInstance ??= createAuth();
  return authInstance;
}
