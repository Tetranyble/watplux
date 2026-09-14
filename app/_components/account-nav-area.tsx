import Link from "next/link";
import { User } from "lucide-react";

import { logoutAction } from "@/app/(storefront)/account/actions";
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
export async function AccountNavArea() {
  const user = await getSessionUser();

  if (!user) {
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
        <User aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          nativeButton={false}
          render={<Link href="/account" />}
        >
          Account
        </DropdownMenuItem>
        <DropdownMenuItem
          nativeButton={false}
          render={<Link href="/account/orders" />}
        >
          Orders
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
