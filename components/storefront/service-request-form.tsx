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
  const [isPending, startTransition] = useTransition();
  const schema = useMemo(
    () =>
      createServiceRequestSchema.superRefine((value, ctx) => {
        if (authenticated) return;
        if (!value.guestName)
          ctx.addIssue({
            code: "custom",
            path: ["guestName"],
            message: "Full name is required.",
          });
        if (!value.guestEmail)
          ctx.addIssue({
            code: "custom",
            path: ["guestEmail"],
            message: "Email is required.",
          });
        if (!value.guestPhone)
          ctx.addIssue({
            code: "custom",
            path: ["guestPhone"],
            message: "Phone is required.",
          });
      }),
    [authenticated],
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
        toast.error("Could not submit request", { description: result.error });
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {!authenticated ? (
        <Card>
          <CardHeader>
            <CardTitle>Your contact details</CardTitle>
            <CardDescription>
              We use these details to follow up on this request.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <ControlledInput
              control={control}
              name="guestName"
              label="Full name"
              autoComplete="name"
              required
              className="sm:col-span-2"
            />
            <ControlledInput
              control={control}
              name="guestEmail"
              label="Email"
              type="email"
              autoComplete="email"
              required
            />
            <ControlledInput
              control={control}
              name="guestPhone"
              label="Phone"
              type="tel"
              autoComplete="tel"
              required
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Property and power needs</CardTitle>
          <CardDescription>
            Give us enough context to prepare before we contact you.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ControlledSelect
            control={control}
            name="propertyType"
            label="Property type"
            options={[
              { value: "RESIDENTIAL", label: "Residential" },
              { value: "COMMERCIAL", label: "Commercial" },
              { value: "INDUSTRIAL", label: "Industrial" },
            ]}
          />
          <ControlledInput
            control={control}
            name="location"
            label="Location"
            placeholder="Area, city or full address"
          />
          <ControlledTextarea
            control={control}
            name="currentElectricitySituation"
            label="Current electricity situation"
            rows={3}
            className="sm:col-span-2"
          />
          <ControlledInput
            control={control}
            name="estimatedMonthlyUsageKwh"
            label="Estimated monthly usage (kWh)"
            type="number"
            min="0"
            step="0.01"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledInput
            control={control}
            name="desiredBackupHours"
            label="Desired backup time (hours)"
            type="number"
            min="0"
            step="0.5"
            valueAsNumber
            emptyAsUndefined
          />
          <ControlledTextarea
            control={control}
            name="appliances"
            label="Appliances / loads"
            rows={4}
            description="List the major equipment you want powered."
            className="sm:col-span-2"
          />
          <ControlledTextarea
            control={control}
            name="existingEquipment"
            label="Existing solar equipment"
            rows={3}
            className="sm:col-span-2"
          />
          <ControlledInput
            control={control}
            name="budgetRange"
            label="Budget range"
            placeholder="Optional"
          />
          <ControlledInput
            control={control}
            name="preferredAppointmentAt"
            label="Preferred appointment"
            type="datetime-local"
          />
          <ControlledTextarea
            control={control}
            name="additionalInfo"
            label="Anything else we should know?"
            rows={4}
            className="sm:col-span-2"
          />
        </CardContent>
      </Card>

      <Button type="submit" size="lg" disabled={isPending || !isValid}>
        {isPending
          ? "Submitting…"
          : serviceType === "INSTALLATION"
            ? "Request installation"
            : "Request consultation"}
      </Button>
    </form>
  );
}
