"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTransition } from "react";
import { useForm } from "react-hook-form";

import { loginFormAction } from "@/app/(storefront)/login/actions";
import { ControlledInput } from "@/components/forms/controlled-fields";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { loginSchema, type LoginInput } from "@/src/modules/auth/schema";

export function LoginForm({ next }: { next?: string }) {
  const [isPending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("email", values.email);
      formData.set("password", values.password);
      if (next) formData.set("next", next);
      const result = await loginFormAction({}, formData);
      if (result?.error)
        toast.error("Could not sign in", { description: result.error });
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <ControlledInput
        control={control}
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        required
        autoFocus
      />
      <ControlledInput
        control={control}
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />
      <div className="-mt-2 flex justify-end">
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary-emphasis hover:underline sm:min-h-8"
        >
          Forgot password?
        </Link>
      </div>
      <Button
        type="submit"
        size="lg"
        disabled={isPending || !isValid}
        className="w-full"
      >
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New to Watplux?{" "}
        <Link
          href="/register"
          className="font-medium text-primary-emphasis hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
