"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck, ShieldMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "@/components/ui/toast";
import { z } from "zod";

import { ControlledSelect } from "@/components/forms/controlled-fields";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { assignRoleSchema } from "@/src/modules/auth/schema";

const ROLE_OPTIONS = ["customer", "staff", "super_admin"] as const;
const roleFormSchema = assignRoleSchema.pick({ roleName: true });
type RoleValues = z.infer<typeof roleFormSchema>;

async function mutateRole(
  userId: string,
  method: "POST" | "DELETE",
  roleName: string,
) {
  const response = await fetch(`/api/admin/users/${userId}/roles`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleName }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Request failed.");
}

function RoleAction({
  userId,
  method,
}: {
  userId: string;
  method: "POST" | "DELETE";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<RoleValues>({
    resolver: zodResolver(roleFormSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { roleName: ROLE_OPTIONS[0] },
  });
  const assigning = method === "POST";

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {assigning ? (
            <ShieldCheck className="size-4" />
          ) : (
            <ShieldMinus className="size-4" />
          )}
          {assigning ? "Assign a role" : "Remove a role"}
        </CardTitle>
        <CardDescription>
          {assigning
            ? "Grant an application role to this customer."
            : "Revoke one application role from this customer."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={handleSubmit((values) =>
            startTransition(async () => {
              try {
                await mutateRole(userId, method, values.roleName);
                toast.success(
                  assigning
                    ? `Assigned the ${values.roleName} role.`
                    : `Removed the ${values.roleName} role.`,
                );
                router.refresh();
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Request failed.",
                );
              }
            }),
          )}
        >
          <ControlledSelect
            control={control}
            name="roleName"
            label="Role"
            options={ROLE_OPTIONS.map((role) => ({
              value: role,
              label: role.replaceAll("_", " "),
            }))}
          />
          <Button
            type="submit"
            size="sm"
            variant={assigning ? "default" : "outline"}
            disabled={isPending || !isValid}
            className="justify-self-start"
          >
            {isPending ? "Saving…" : assigning ? "Assign role" : "Remove role"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function RoleManagementForm({ userId }: { userId: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <RoleAction userId={userId} method="POST" />
      <RoleAction userId={userId} method="DELETE" />
    </div>
  );
}
