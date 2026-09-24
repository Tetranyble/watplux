"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTransition } from "react";
import { useForm } from "react-hook-form";

import { forgotPasswordFormAction } from "./actions";
import { ControlledInput } from "@/components/forms/controlled-fields";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  requestPasswordResetSchema,
  type RequestPasswordResetInput,
} from "@/src/modules/auth/schema";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

export function ForgotPasswordForm() {
  const copy = useSiteCopy();
  const [isPending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    reset,
    formState: { isValid },
  } = useForm<RequestPasswordResetInput>({
    resolver: zodResolver(requestPasswordResetSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("email", values.email);
      const result = await forgotPasswordFormAction({}, formData);
      if (result.error) {
        toast.error(copy("auth.forgot.errorTitle"), {
          description: result.error,
        });
        return;
      }
      reset({ email: "" });
      toast.success(copy("auth.forgot.successTitle"), {
        description: copy("auth.forgot.successDescription"),
      });
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <ControlledInput
        control={control}
        name="email"
        label={copy("auth.emailLabel")}
        type="email"
        autoComplete="email"
        placeholder={copy("auth.emailPlaceholder")}
        required
        autoFocus
      />
      <Button type="submit" size="lg" disabled={isPending || !isValid}>
        {isPending ? copy("auth.forgot.sending") : copy("auth.forgot.submit")}
      </Button>
      <Button
        variant="ghost"
        nativeButton={false}
        render={<Link href="/login" />}
      >
        {copy("auth.backToSignIn")}
      </Button>
    </form>
  );
}
