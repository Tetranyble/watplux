"use server";

import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { resendVerificationSchema } from "@/src/modules/auth/schema";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export interface ResendVerificationFormState {
  error?: string;
  success?: boolean;
}

export async function resendVerificationFormAction(
  _previousState: ResendVerificationFormState,
  formData: FormData,
): Promise<ResendVerificationFormState> {
  const copy = await getSiteCopy();
  const parsed = resendVerificationSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        copyValue(copy, "auth.verify.invalid"),
    };
  }

  try {
    await getAuth().api.sendVerificationEmail({
      body: {
        email: parsed.data.email,
        callbackURL: "/login?verified=1",
      },
      headers: await headers(),
    });
  } catch (error) {
    logger.error({ err: error }, "Verification email resend failed");
  }

  return { success: true };
}
