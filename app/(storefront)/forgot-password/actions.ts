"use server";

import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { requestPasswordResetSchema } from "@/src/modules/auth/schema";

export interface ForgotPasswordFormState {
  error?: string;
  success?: boolean;
}

export async function forgotPasswordFormAction(
  _previousState: ForgotPasswordFormState,
  formData: FormData,
): Promise<ForgotPasswordFormState> {
  const parsed = requestPasswordResetSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
    };
  }

  try {
    await getAuth().api.requestPasswordReset({
      body: { email: parsed.data.email, redirectTo: "/reset-password" },
      headers: await headers(),
    });
  } catch (error) {
    // The response remains deliberately indistinguishable for unknown and
    // registered addresses. Delivery failures are operationally visible only.
    logger.error({ err: error }, "Password reset email request failed");
  }

  return { success: true };
}
