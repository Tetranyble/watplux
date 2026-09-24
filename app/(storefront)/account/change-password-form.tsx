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
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

export function ChangePasswordForm() {
  const copy = useSiteCopy();
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
        toast.error(copy("account.password.errorTitle"), {
          description: result.error,
        });
        return;
      }
      if (result.success) {
        toast.success(copy("account.password.successTitle"), {
          description: result.success,
        });
        reset();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <ControlledInput
        control={control}
        name="currentPassword"
        label={copy("account.password.current")}
        type="password"
        autoComplete="current-password"
        required
      />
      <ControlledInput
        control={control}
        name="newPassword"
        label={copy("account.password.new")}
        type="password"
        autoComplete="new-password"
        required
        description={copy("account.password.help")}
      />
      <ControlledInput
        control={control}
        name="confirmPassword"
        label={copy("account.password.confirm")}
        type="password"
        autoComplete="new-password"
        required
      />
      <Button
        type="submit"
        disabled={isPending || !isDirty || !isValid}
        className="self-start"
      >
        {isPending
          ? copy("account.password.updating")
          : copy("account.password.submit")}
      </Button>
    </form>
  );
}
