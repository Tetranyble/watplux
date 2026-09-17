"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { registerSchema } from "@/src/modules/auth/schema";

export interface RegisterFormState {
  error?: string;
}

export async function registerFormAction(
  _prevState: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Check your details and try again.",
    };
  }

  try {
    await getAuth().api.signUpEmail({
      body: { ...parsed.data, callbackURL: "/login?verified=1" },
      headers: await headers(),
    });
  } catch {
    return {
      error:
        "We could not create that account. Try signing in if you already registered.",
    };
  }

  redirect("/verify-email?sent=1");
}
