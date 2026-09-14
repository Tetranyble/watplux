"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";

import { changePasswordAction } from "@/app/(storefront)/account/actions";
import { ControlledInput } from "@/components/forms/controlled-fields";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  changePasswordSchema,
  type ChangePasswordInput,
} from "@/src/modules/auth/schema";

export function ChangePasswordForm() {
  const [isPending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    reset,
    formState: { isValid, isDirty },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("currentPassword", values.currentPassword);
      formData.set("newPassword", values.newPassword);
      formData.set("confirmPassword", values.confirmPassword);
      const result = await changePasswordAction({}, formData);
      if (result.error) {
        toast.error("Could not update password", { description: result.error });
        return;
      }
      if (result.success) {
        toast.success("Password updated", { description: result.success });
        reset();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <ControlledInput
        control={control}
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
      />
      <ControlledInput
        control={control}
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        description="Your new password is checked as you type."
      />
      <ControlledInput
        control={control}
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
      />
      <Button
        type="submit"
        disabled={isPending || !isDirty || !isValid}
        className="self-start"
      >
        {isPending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
