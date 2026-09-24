"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  ControlledInput,
  ControlledTextarea,
} from "@/components/forms/controlled-fields";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { addressInputSchema } from "@/src/modules/checkout/schema";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
function formSchema(isAuthenticated: boolean, copy: (key: string) => string) {
  return addressInputSchema
    .extend({
      guestEmail: z.preprocess(
        emptyToUndefined,
        z
          .string()
          .trim()
          .email(copy("commerce.checkout.invalidEmail"))
          .max(255)
          .optional(),
      ),
      guestPhone: z.preprocess(
        emptyToUndefined,
        z.string().trim().max(32).optional(),
      ),
    })
    .superRefine((value, ctx) => {
      if (!isAuthenticated && !value.guestEmail)
        ctx.addIssue({
          code: "custom",
          path: ["guestEmail"],
          message: copy("commerce.checkout.emailRequired"),
        });
    });
}
type InputValues = z.input<ReturnType<typeof formSchema>>;
type OutputValues = z.output<ReturnType<typeof formSchema>>;

export function CheckoutAddressForm({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
  const copy = useSiteCopy();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const schema = useMemo(
    () => formSchema(isAuthenticated, copy),
    [isAuthenticated, copy],
  );
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<InputValues, unknown, OutputValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      fullName: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      country: "NG",
      postalCode: "",
      deliveryNotes: "",
      guestEmail: "",
      guestPhone: "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      try {
        const response = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shippingAddress: {
              fullName: values.fullName,
              phone: values.phone,
              addressLine1: values.addressLine1,
              addressLine2: values.addressLine2 || undefined,
              city: values.city,
              state: values.state,
              country: values.country || "NG",
              postalCode: values.postalCode || undefined,
              deliveryNotes: values.deliveryNotes || undefined,
            },
            guestEmail: isAuthenticated ? undefined : values.guestEmail,
            guestPhone: isAuthenticated ? undefined : values.guestPhone,
          }),
        });
        const body = await response.json();
        if (!response.ok) {
          toast.error(copy("commerce.checkout.continueError"), {
            description: body?.error ?? copy("commerce.checkout.checkDetails"),
          });
          return;
        }
        const { order, payment, guestOrderAccessToken } = body as {
          order: { id: string };
          payment:
            | { outcome: "PENDING"; authorizationUrl: string }
            | { outcome: "INITIALIZATION_FAILED" };
          guestOrderAccessToken?: string;
        };
        if (payment.outcome === "PENDING") {
          window.location.href = payment.authorizationUrl;
          return;
        }
        router.push(
          guestOrderAccessToken
            ? `/checkout/payment-result?orderId=${order.id}&guestToken=${encodeURIComponent(guestOrderAccessToken)}`
            : `/checkout/payment-result?orderId=${order.id}`,
        );
      } catch {
        toast.error(copy("commerce.checkout.failed"), {
          description: copy("commerce.checkout.generalError"),
        });
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {!isAuthenticated ? (
        <Card>
          <CardHeader>
            <CardTitle>{copy("commerce.checkout.contact")}</CardTitle>
            <CardDescription>
              {copy("commerce.checkout.contactDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <ControlledInput
              control={control}
              name="guestEmail"
              label={copy("commerce.checkout.email")}
              type="email"
              autoComplete="email"
              required
            />
            <ControlledInput
              control={control}
              name="guestPhone"
              label={copy("commerce.checkout.phone")}
              type="tel"
              autoComplete="tel"
              description={copy("commerce.checkout.phoneHelp")}
            />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{copy("commerce.checkout.delivery")}</CardTitle>
          <CardDescription>
            {copy("commerce.checkout.deliveryDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ControlledInput
            control={control}
            name="fullName"
            label={copy("commerce.checkout.fullName")}
            autoComplete="name"
            required
            className="sm:col-span-2"
          />
          <ControlledInput
            control={control}
            name="phone"
            label={copy("commerce.checkout.phone")}
            type="tel"
            autoComplete="tel"
            required
            className="sm:col-span-2"
          />
          <ControlledInput
            control={control}
            name="addressLine1"
            label={copy("commerce.checkout.address")}
            autoComplete="address-line1"
            required
            className="sm:col-span-2"
          />
          <ControlledInput
            control={control}
            name="addressLine2"
            label={copy("commerce.checkout.address2")}
            autoComplete="address-line2"
            className="sm:col-span-2"
          />
          <ControlledInput
            control={control}
            name="city"
            label={copy("commerce.checkout.city")}
            autoComplete="address-level2"
            required
          />
          <ControlledInput
            control={control}
            name="state"
            label={copy("commerce.checkout.state")}
            autoComplete="address-level1"
            required
          />
          <ControlledInput
            control={control}
            name="postalCode"
            label={copy("commerce.checkout.postal")}
            autoComplete="postal-code"
          />
          <ControlledTextarea
            control={control}
            name="deliveryNotes"
            label={copy("commerce.checkout.notes")}
            rows={3}
            className="sm:col-span-2"
          />
        </CardContent>
      </Card>
      <Button type="submit" size="lg" disabled={isPending || !isValid}>
        {isPending
          ? copy("commerce.checkout.preparing")
          : copy("commerce.checkout.continue")}
      </Button>
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <LockKeyhole className="size-3.5" />
        {copy("commerce.checkout.security")}
      </div>
    </form>
  );
}
