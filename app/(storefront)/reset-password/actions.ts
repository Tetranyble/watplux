"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { resetPasswordSchema } from "@/src/modules/auth/schema";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export interface ResetPasswordFormState {
  error?: string;
}

export async function resetPasswordFormAction(
  _previousState: ResetPasswordFormState,
  formData: FormData,
): Promise<ResetPasswordFormState> {
  const copy = await getSiteCopy();
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        copyValue(copy, "auth.reset.invalid"),
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
      error: copyValue(copy, "auth.reset.expired"),
    };
  }

  redirect("/login?reset=1");
}
