"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { submitServiceRequest } from "@/app/(storefront)/services/actions";
import {
  ControlledInput,
  ControlledSelect,
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
import { createServiceRequestSchema } from "@/src/modules/service-request/schema";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

type InputValues = z.input<typeof createServiceRequestSchema>;
type OutputValues = z.output<typeof createServiceRequestSchema>;

function setOptional(formData: FormData, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  formData.set(
    key,
    value instanceof Date ? value.toISOString() : String(value),
  );
}

export function ServiceRequestForm({
  serviceType,
  authenticated,
}: {
  serviceType: "CONSULTATION" | "INSTALLATION";
  authenticated: boolean;
}) {
  const copy = useSiteCopy();
  const [isPending, startTransition] = useTransition();
  const schema = useMemo(
    () =>
      createServiceRequestSchema.superRefine((value, ctx) => {
        if (authenticated) return;
        if (!value.guestName)
          ctx.addIssue({
            code: "custom",
            path: ["guestName"],
            message: copy("services.form.nameRequired"),
          });
        if (!value.guestEmail)
          ctx.addIssue({
            code: "custom",
            path: ["guestEmail"],
            message: copy("services.form.emailRequired"),
          });
        if (!value.guestPhone)
          ctx.addIssue({
            code: "custom",
            path: ["guestPhone"],
            message: copy("services.form.phoneRequired"),
          });
      }),
    [authenticated, copy],
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
      serviceType,
      propertyType: "RESIDENTIAL",
      guestName: "",
      guestEmail: "",
      guestPhone: "",
      location: "",
      currentElectricitySituation: "",
      appliances: "",
      existingEquipment: "",
      budgetRange: "",
      additionalInfo: "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("serviceType", serviceType);
      for (const key of [
        "guestName",
        "guestEmail",
        "guestPhone",
        "propertyType",
        "location",
        "currentElectricitySituation",
        "estimatedMonthlyUsageKwh",
        "appliances",
        "desiredBackupHours",
        "existingEquipment",
        "budgetRange",
        "preferredAppointmentAt",
        "additionalInfo",
      ] as const) {
        setOptional(formData, key, values[key]);
      }
      const result = await submitServiceRequest({}, formData);
      if (result?.error)
        toast.error(copy("services.form.submitErrorTitle"), {
          description: result.error,
        });
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {!authenticated ? (
        <Card>
          <CardHeader>
            <CardTitle>{copy("services.form.contactTitle")}</CardTitle>
            <CardDescription>
              {copy("services.form.contactDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <ControlledInput
              control={control}
              name="guestName"
              label={copy("services.form.fullName")}
              autoComplete="name"
              required
              className="sm:col-span-2"
            />
            <ControlledInput
              control={control}
              name="guestEmail"
              label={copy("services.form.email")}
              type="email"
              autoComplete="email"
              required
            />
            <ControlledInput
              control={control}
              name="guestPhone"
              label={copy("services.form.phone")}
              type="tel"
              autoComplete="tel"
              required
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{copy("services.form.needsTitle")}</CardTitle>
          <CardDescription>
            {copy("services.form.needsDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ControlledSelect
            control={control}
            name="propertyType"
            label={copy("services.form.propertyType")}
            options={[
              {
                value: "RESIDENTIAL",
                label: copy("services.form.residential"),
              },
              { value: "COMMERCIAL", label: copy("services.form.commercial") },
              { value: "INDUSTRIAL", label: copy("services.form.industrial") },
            ]}
          />
          <ControlledInput
            control={control}
            name="location"
            label={copy("services.form.location")}
            placeholder={copy("services.form.locationPlaceholder")}
          />
          <ControlledTextarea
            control={control}
            name="currentElectricitySituation"
            label={copy("services.form.electricity")}
            rows={3}
            className="sm:col-span-2"
          />
          <ControlledInput
            control={control}
            name="estimatedMonthlyUsageKwh"
            label={copy("services.form.usage")}
            type="number"
            min="0"
            step="0.01"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="desiredBackupHours"
            label={copy("services.form.backup")}
            type="number"
            min="0"
            step="0.5"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledTextarea
            control={control}
            name="appliances"
            label={copy("services.form.appliances")}
            rows={4}
            description={copy("services.form.appliancesHelp")}
            className="sm:col-span-2"
          />
          <ControlledTextarea
            control={control}
            name="existingEquipment"
            label={copy("services.form.equipment")}
            rows={3}
            className="sm:col-span-2"
          />
          <ControlledInput
            control={control}
            name="budgetRange"
            label={copy("services.form.budget")}
            placeholder={copy("services.form.optional")}
          />
          <ControlledInput
            control={control}
            name="preferredAppointmentAt"
            label={copy("services.form.appointment")}
            type="datetime-local"
          />
          <ControlledTextarea
            control={control}
            name="additionalInfo"
            label={copy("services.form.additional")}
            rows={4}
            className="sm:col-span-2"
          />
        </CardContent>
      </Card>

      <Button type="submit" size="lg" disabled={isPending || !isValid}>
        {isPending
          ? copy("services.form.submitting")
          : serviceType === "INSTALLATION"
            ? copy("services.form.installationSubmit")
            : copy("services.form.consultationSubmit")}
      </Button>
    </form>
  );
}
