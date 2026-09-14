import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";

import { RoleManagementForm } from "@/components/admin/role-management-form";
import { UserSecurityActions } from "@/components/admin/user-security-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotFoundError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import { getUserForAdmin } from "@/src/modules/auth/use-cases/get-user-for-admin";

export const metadata: Metadata = { title: "Customer detail" };
export const instant = false;
const userIdParamSchema = z.coerce.bigint().positive();

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) return null;
  const { userId } = await params;
  const parsed = userIdParamSchema.safeParse(userId);
  if (!parsed.success) notFound();

  let profile;
  try {
    profile = await getUserForAdmin(actor, parsed.data);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="flex max-w-4xl flex-col gap-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 mb-2"
            nativeButton={false}
            render={<Link href="/admin/customers" />}
          >
            ← Customers
          </Button>
          <h1 className="text-3xl font-semibold tracking-tight">
            {profile.name}
          </h1>
          <p className="mt-1 text-muted-foreground">{profile.email}</p>
        </div>
        <Badge
          variant={profile.status === "ACTIVE" ? "default" : "destructive"}
        >
          {profile.status}
        </Badge>
      </div>

      <section className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Email
          </p>
          <p className="mt-1 font-medium">
            {profile.emailVerified ? "Verified" : "Not verified"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Joined
          </p>
          <p className="mt-1 font-medium">{formatDate(profile.createdAt)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Roles
          </p>
          <p className="mt-1 font-medium">
            {profile.roles.join(", ") || "None"}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Account security</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Suspending an account also revokes its active Better Auth sessions.
        </p>
        <UserSecurityActions
          userId={profile.id.toString()}
          status={profile.status}
        />
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Roles & access</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Role changes are translated into the existing granular permission
          model; business routes still enforce permissions server-side.
        </p>
        <RoleManagementForm userId={profile.id.toString()} />
      </section>
    </div>
  );
}
