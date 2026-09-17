"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { resetPasswordSchema } from "@/src/modules/auth/schema";

export interface ResetPasswordFormState {
  error?: string;
}

export async function resetPasswordFormAction(
  _previousState: ResetPasswordFormState,
  formData: FormData,
): Promise<ResetPasswordFormState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Check the password fields and try again.",
    };
  }

  try {
    await getAuth().api.resetPassword({
      body: {
        token: parsed.data.token,
        newPassword: parsed.data.newPassword,
      },
      headers: await headers(),
    });
  } catch {
    return {
      error:
        "This reset link is invalid or has expired. Request a new link and try again.",
    };
  }

  redirect("/login?reset=1");
}
