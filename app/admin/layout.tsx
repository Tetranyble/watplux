import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AdminAccountMenu } from "@/app/admin/_components/admin-account-menu";
import { AdminHeader } from "@/components/admin/admin-header";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = {
  title: { default: "Operations", template: "%s | Watplux Operations" },
};
export const instant = false;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login?next=/admin");
  if (actor.permissions.size === 0) redirect("/account");

  return (
    <div className="min-h-screen bg-background lg:flex">
      <a
        href="#admin-main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only"
      >
        Skip to operations content
      </a>
      <AdminSidebar permissions={actor.permissions} />
      <div className="min-w-0 flex-1">
        <AdminHeader
          permissions={actor.permissions}
          accountSlot={<AdminAccountMenu email={actor.email} />}
        />
        <main
          id="admin-main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
