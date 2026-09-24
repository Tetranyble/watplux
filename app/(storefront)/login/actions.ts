"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";

import { getAuth } from "@/lib/auth";
import { clearGuestCartCookie, getRawGuestCartToken } from "@/lib/cart-actor";
import { getSessionUser } from "@/lib/session";
import { safeInternalPath } from "@/lib/request-security";
import { loginSchema } from "@/src/modules/auth/schema";
import { mergeGuestCartTokenIntoUserCart } from "@/src/modules/cart/use-cases/merge-guest-cart-into-user-cart";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export interface LoginFormState {
  error?: string;
}

export async function loginFormAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const copy = await getSiteCopy();
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: copyValue(copy, "auth.login.invalid") };
  }

  try {
    await getAuth().api.signInEmail({
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        rememberMe: true,
      },
      headers: await headers(),
    });

    // Preserve the established guest-cart merge after a successful auth.
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
  } catch (error) {
    if (
      error instanceof APIError &&
      error.body?.code === "EMAIL_NOT_VERIFIED"
    ) {
      return {
        error: copyValue(copy, "auth.login.verify"),
      };
    }
    // Keep authentication failure intentionally generic.
    return { error: copyValue(copy, "auth.login.credentials") };
  }

  redirect(safeInternalPath(formData.get("next"), "/account"));
}
