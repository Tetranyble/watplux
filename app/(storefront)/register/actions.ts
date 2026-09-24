"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { registerSchema } from "@/src/modules/auth/schema";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export interface RegisterFormState {
  error?: string;
}

export async function registerFormAction(
  _prevState: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  const copy = await getSiteCopy();
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        copyValue(copy, "auth.register.invalid"),
    };
  }

  try {
    await getAuth().api.signUpEmail({
      body: { ...parsed.data, callbackURL: "/login?verified=1" },
      headers: await headers(),
    });
  } catch {
    return {
      error: copyValue(copy, "auth.register.failed"),
    };
  }

  redirect("/verify-email?sent=1");
}
