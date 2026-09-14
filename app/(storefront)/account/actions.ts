"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { changePasswordSchema } from "@/src/modules/auth/schema";

export async function logoutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}

export async function logoutAllAction(): Promise<void> {
  await getAuth().api.revokeSessions({ headers: await headers() });
  redirect("/login");
}

export interface ChangePasswordState {
  error?: string;
  success?: string;
}

export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Check the password fields.",
    };
  }

  try {
    await getAuth().api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
    return {
      success: "Password updated. Other signed-in devices were logged out.",
    };
  } catch {
    return {
      error:
        "We could not change your password. Check your current password and try again.",
    };
  }
}
