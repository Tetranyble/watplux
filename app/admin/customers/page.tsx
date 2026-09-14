import Link from "next/link";
import type { Metadata } from "next";

import { CustomerFilterForm } from "@/components/admin/customer-filter-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import { listUsersForAdmin } from "@/src/modules/auth/use-cases/list-users-for-admin";

export const metadata: Metadata = { title: "Customers" };
export const instant = false;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getSessionUser();
  if (!actor) return null;
  const params = await searchParams;
  const one = (key: string) =>
    Array.isArray(params[key]) ? params[key]?.[0] : params[key];
  const status = one("status");
  const page = await listUsersForAdmin(actor, {
    limit: 25,
    cursor: one("cursor"),
    search: one("q"),
    status: status === "ACTIVE" || status === "SUSPENDED" ? status : undefined,
  });

  const next = new URLSearchParams();
  if (one("q")) next.set("q", one("q")!);
  if (status) next.set("status", status);
  if (page.nextCursor) next.set("cursor", page.nextCursor);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-primary">People</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Customers & staff
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search accounts, review access and suspend compromised accounts.
        </p>
      </div>
      <CustomerFilterForm query={one("q")} status={status} />
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="font-medium">{user.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {user.email}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      user.status === "ACTIVE" ? "default" : "destructive"
                    }
                  >
                    {user.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {user.roles.join(", ") || "—"}
                </TableCell>
                <TableCell>{formatDate(user.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`/admin/customers/${user.id}`} />}
                  >
                    Manage
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {page.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matching users.</p>
      ) : null}
      {page.nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/admin/customers?${next.toString()}`} />}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
