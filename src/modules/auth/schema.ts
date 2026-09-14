import { z } from "zod";

import { checkPasswordPolicy } from "@/src/modules/auth/domain/password-policy";

/**
 * Single source of truth for auth-related input shapes — imported by both
 * the eventual form (client-side UX validation) and the use-case
 * (authoritative validation), per docs/ARCHITECTURE.md §17. Password policy
 * is enforced here via the pure domain function, not duplicated as inline
 * regex.
 */

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(255);

const passwordPolicySchema = z.string().superRefine((password, ctx) => {
  const result = checkPasswordPolicy(password);
  if (!result.valid) {
    for (const reason of result.reasons) {
      ctx.addIssue({ code: "custom", message: reason });
    }
  }
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordPolicySchema,
  name: z.string().trim().min(1, "Name is required.").max(255),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Login intentionally does NOT re-run the strength policy — an existing
  // account's password may predate a policy tightening; login only checks
  // the password is present, actual correctness is Argon2 verification.
  password: z.string().min(1, "Password is required."),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .superRefine((value, ctx) => {
    if (value.newPassword !== value.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "The new passwords do not match.",
      });
    }
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const assignRoleSchema = z.object({
  userId: z.coerce.bigint(),
  roleName: z.string().min(1),
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const removeRoleSchema = assignRoleSchema;
export type RemoveRoleInput = z.infer<typeof removeRoleSchema>;
