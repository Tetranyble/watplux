"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";

import { resetPasswordFormAction } from "./actions";
import { ControlledInput } from "@/components/forms/controlled-fields";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/src/modules/auth/schema";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

export function ResetPasswordForm({ token }: { token: string }) {
  const copy = useSiteCopy();
  const [isPending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { token, newPassword: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("token", values.token);
      formData.set("newPassword", values.newPassword);
      formData.set("confirmPassword", values.confirmPassword);
      const result = await resetPasswordFormAction({}, formData);
      if (result?.error) {
        toast.error(copy("auth.reset.errorTitle"), {
          description: result.error,
        });
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <ControlledInput
        control={control}
        name="newPassword"
        label={copy("auth.reset.newPassword")}
        type="password"
        autoComplete="new-password"
        required
        autoFocus
        description={copy("auth.passwordHelp")}
      />
      <ControlledInput
        control={control}
        name="confirmPassword"
        label={copy("auth.reset.confirmPassword")}
        type="password"
        autoComplete="new-password"
        required
      />
      <Button type="submit" size="lg" disabled={isPending || !isValid}>
        {isPending ? copy("auth.reset.updating") : copy("auth.reset.submit")}
      </Button>
    </form>
  );
}
