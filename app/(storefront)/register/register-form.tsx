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
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

export function RegisterForm() {
  const copy = useSiteCopy();
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
        toast.error(copy("auth.register.errorTitle"), {
          description: result.error,
        });
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <ControlledInput
        control={control}
        name="name"
        label={copy("auth.register.name")}
        autoComplete="name"
        required
        autoFocus
      />
      <ControlledInput
        control={control}
        name="email"
        label={copy("auth.emailLabel")}
        type="email"
        autoComplete="email"
        required
      />
      <ControlledInput
        control={control}
        name="password"
        label={copy("auth.passwordLabel")}
        type="password"
        autoComplete="new-password"
        required
        description={copy("auth.passwordHelp")}
      />
      <Button type="submit" size="lg" disabled={isPending || !isValid}>
        {isPending
          ? copy("auth.register.creating")
          : copy("auth.register.submit")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {copy("auth.register.existing")}{" "}
        <Link
          href="/login"
          className="font-medium text-primary-emphasis hover:underline"
        >
          {copy("auth.register.signIn")}
        </Link>
      </p>
    </form>
  );
}
