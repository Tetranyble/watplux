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

export function ForgotPasswordForm() {
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
        toast.error("Could not request a reset", {
          description: result.error,
        });
        return;
      }
      reset({ email: "" });
      toast.success("Check your inbox", {
        description:
          "If an account uses that address, we sent a password-reset link.",
      });
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
      <Button type="submit" size="lg" disabled={isPending || !isValid}>
        {isPending ? "Sending link…" : "Send reset link"}
      </Button>
      <Button
        variant="ghost"
        nativeButton={false}
        render={<Link href="/login" />}
      >
        Back to sign in
      </Button>
    </form>
  );
}
