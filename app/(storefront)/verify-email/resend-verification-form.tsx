"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTransition } from "react";
import { useForm } from "react-hook-form";

import { resendVerificationFormAction } from "./actions";
import { ControlledInput } from "@/components/forms/controlled-fields";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  resendVerificationSchema,
  type ResendVerificationInput,
} from "@/src/modules/auth/schema";

export function ResendVerificationForm() {
  const [isPending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    reset,
    formState: { isValid },
  } = useForm<ResendVerificationInput>({
    resolver: zodResolver(resendVerificationSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("email", values.email);
      const result = await resendVerificationFormAction({}, formData);
      if (result.error) {
        toast.error("Could not resend verification", {
          description: result.error,
        });
        return;
      }
      reset({ email: "" });
      toast.success("Verification link requested", {
        description:
          "If that address is awaiting verification, a fresh link is on its way.",
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
      />
      <Button type="submit" disabled={isPending || !isValid}>
        {isPending ? "Sending…" : "Resend verification email"}
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
