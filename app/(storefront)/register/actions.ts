"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { clearGuestCartCookie, getRawGuestCartToken } from "@/lib/cart-actor";
import { getSessionUser } from "@/lib/session";
import { registerSchema } from "@/src/modules/auth/schema";
import { mergeGuestCartTokenIntoUserCart } from "@/src/modules/cart/use-cases/merge-guest-cart-into-user-cart";

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
      body: parsed.data,
      headers: await headers(),
    });
    const [actor, guestRawToken] = await Promise.all([
      getSessionUser(),
      getRawGuestCartToken(),
    ]);
    if (actor && guestRawToken) {
      const merged = await mergeGuestCartTokenIntoUserCart(
        actor.id,
        guestRawToken,
      );
      if (merged.merged) await clearGuestCartCookie();
    }
  } catch {
    return {
      error:
        "We could not create that account. Try signing in if you already registered.",
    };
  }

  redirect("/account");
}
