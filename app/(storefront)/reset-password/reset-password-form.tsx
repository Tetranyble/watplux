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

export function ResetPasswordForm({ token }: { token: string }) {
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
        toast.error("Could not reset password", {
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
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        autoFocus
        description="Use at least 10 characters and a strong mix of characters."
      />
      <ControlledInput
        control={control}
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
      />
      <Button type="submit" size="lg" disabled={isPending || !isValid}>
        {isPending ? "Updating password…" : "Update password"}
      </Button>
    </form>
  );
}
