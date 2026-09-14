"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTransition } from "react";
import { useForm } from "react-hook-form";

import { registerFormAction } from "./actions";
import { ControlledInput } from "@/components/forms/controlled-fields";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { registerSchema, type RegisterInput } from "@/src/modules/auth/schema";

export function RegisterForm() {
  const [isPending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { name: "", email: "", password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("name", values.name);
      formData.set("email", values.email);
      formData.set("password", values.password);
      const result = await registerFormAction({}, formData);
      if (result?.error)
        toast.error("Could not create account", { description: result.error });
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <ControlledInput
        control={control}
        name="name"
        label="Full name"
        autoComplete="name"
        required
        autoFocus
      />
      <ControlledInput
        control={control}
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        required
      />
      <ControlledInput
        control={control}
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        description="Use at least 10 characters and a strong mix of characters."
      />
      <Button type="submit" size="lg" disabled={isPending || !isValid}>
        {isPending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
