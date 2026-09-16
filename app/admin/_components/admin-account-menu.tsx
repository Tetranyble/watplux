import Link from "next/link";
import {
  CalendarCheck,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  Settings,
} from "lucide-react";

import { logoutAction } from "@/app/(storefront)/account/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Lives under `app/admin/_components/` (not `components/admin/`) because
 * it imports the existing `logoutAction` Server Action — `components/**`
 * stays presentational-only in this codebase's ESLint boundary rules;
 * `app/**` pieces that need a use-case/action import live here, matching
 * `app/_components/account-nav-area.tsx`'s established precedent exactly.
 * Reuses the same session-clearing Server Action the storefront account
 * menu already uses — no second logout mechanism.
 */
function initials(name: string, email: string) {
  const value = name.trim() || email.split("@")[0] || "User";
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function AdminAccountMenu({
  name,
  email,
  image,
}: {
  name: string;
  email: string;
  image: string | null;
}) {
  const fallback = initials(name, email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-10 rounded-full p-0 ring-offset-2 ring-offset-background hover:bg-transparent hover:ring-2 hover:ring-border focus-visible:ring-2"
            aria-label={`Account menu for ${name || email}`}
          />
        }
      >
        <Avatar className="size-9 ring-1 ring-border">
          {image ? <AvatarImage src={image} alt="" /> : null}
          <AvatarFallback>{fallback}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-72 border border-border bg-background p-0 text-foreground shadow-lg"
      >
        <DropdownMenuGroup className="border-b">
          <DropdownMenuLabel className="p-4 font-normal">
            <span className="flex items-center gap-3">
              <Avatar className="size-9 ring-1 ring-border">
                {image ? <AvatarImage src={image} alt="" /> : null}
                <AvatarFallback>{fallback}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {email}
                </span>
              </span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuGroup className="p-1.5">
          <DropdownMenuItem
            nativeButton={false}
            render={<Link href="/admin" />}
            className="gap-3 px-3 py-2.5"
          >
            <LayoutDashboard
              className="text-muted-foreground"
              aria-hidden="true"
            />
            Dashboard
          </DropdownMenuItem>
          <DropdownMenuItem
            nativeButton={false}
            render={<Link href="/account" />}
            className="gap-3 px-3 py-2.5"
          >
            <Settings className="text-muted-foreground" aria-hidden="true" />
            Account settings
          </DropdownMenuItem>
          <DropdownMenuItem
            nativeButton={false}
            render={<Link href="/account/orders" />}
            className="gap-3 px-3 py-2.5"
          >
            <PackageCheck
              className="text-muted-foreground"
              aria-hidden="true"
            />
            My orders
          </DropdownMenuItem>
          <DropdownMenuItem
            nativeButton={false}
            render={<Link href="/account/service-requests" />}
            className="gap-3 px-3 py-2.5"
          >
            <CalendarCheck
              className="text-muted-foreground"
              aria-hidden="true"
            />
            Service requests
          </DropdownMenuItem>
          <DropdownMenuItem
            nativeButton={false}
            render={<Link href="/" />}
            className="gap-3 px-3 py-2.5"
          >
            <ExternalLink
              className="text-muted-foreground"
              aria-hidden="true"
            />
            View storefront
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="m-0" />
        <DropdownMenuItem
          variant="destructive"
          render={<form action={logoutAction} className="w-full" />}
          className="m-1.5 p-0"
        >
          <Button
            type="submit"
            variant="ghost"
            className="h-auto w-full justify-start gap-3 px-3 py-2.5 font-normal text-inherit hover:bg-transparent"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </Button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
