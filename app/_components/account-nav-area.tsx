import Link from "next/link";
import {
  ClipboardList,
  LayoutDashboard,
  LogIn,
  LogOut,
  Package,
  User,
} from "lucide-react";

import { logoutAction } from "@/app/(storefront)/account/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getSessionUser } from "@/lib/session";

/**
 * Genuinely dynamic (session-cookie-dependent) header/mobile-nav slice —
 * lives under `app/` for the same use-case-access reason as
 * `CartCountBadge`. `getSessionUser()` is already `cache()`-wrapped
 * (`lib/session.ts`), so rendering it here and in a page body in the same
 * request tree costs one DB round-trip, not two.
 */
function initials(name: string, email: string) {
  const value = name.trim() || email.split("@")[0] || "User";
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export async function AccountNavArea({
  variant = "desktop",
}: {
  variant?: "desktop" | "mobile";
}) {
  const user = await getSessionUser();

  if (!user) {
    if (variant === "mobile") {
      return (
        <div className="grid gap-3">
          <div>
            <p className="text-sm font-semibold">Your Watplux account</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Sign in to track orders and service requests.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/register" />}
            >
              Create account
            </Button>
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              <LogIn aria-hidden="true" />
              Log in
            </Button>
          </div>
        </div>
      );
    }

    return (
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href="/login" />}
      >
        Log in
      </Button>
    );
  }

  if (variant === "mobile") {
    return (
      <div className="grid gap-3">
        <div className="flex items-center gap-3 px-1">
          <Avatar className="size-9 ring-1 ring-border">
            {user.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
        </div>
        <div className="grid gap-1">
          {user.permissions.size > 0 ? (
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              nativeButton={false}
              render={<Link href="/admin" />}
            >
              <LayoutDashboard aria-hidden="true" />
              Admin dashboard
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            nativeButton={false}
            render={<Link href="/account" />}
          >
            <User aria-hidden="true" />
            Account settings
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            nativeButton={false}
            render={<Link href="/account/orders" />}
          >
            <Package aria-hidden="true" />
            My orders
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            nativeButton={false}
            render={<Link href="/account/service-requests" />}
          >
            <ClipboardList aria-hidden="true" />
            Service requests
          </Button>
        </div>
        <form action={logoutAction}>
          <Button
            type="submit"
            variant="ghost"
            className="w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </form>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Account menu for ${user.email}`}
          />
        }
      >
        <Avatar className="size-8 ring-1 ring-border">
          {user.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {user.permissions.size > 0 ? (
          <DropdownMenuItem
            nativeButton={false}
            render={<Link href="/admin" />}
            className="gap-2"
          >
            <LayoutDashboard aria-hidden="true" />
            Admin dashboard
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          nativeButton={false}
          render={<Link href="/account" />}
          className="gap-2"
        >
          <User aria-hidden="true" />
          Account
        </DropdownMenuItem>
        <DropdownMenuItem
          nativeButton={false}
          render={<Link href="/account/orders" />}
          className="gap-2"
        >
          <Package aria-hidden="true" />
          Orders
        </DropdownMenuItem>
        <DropdownMenuItem
          nativeButton={false}
          render={<Link href="/account/service-requests" />}
          className="gap-2"
        >
          <ClipboardList aria-hidden="true" />
          Service requests
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<form action={logoutAction} className="w-full" />}
        >
          <Button
            type="submit"
            variant="ghost"
            className="h-auto w-full justify-start p-0 font-normal"
          >
            Log out
          </Button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
