import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/(storefront)/account/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
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
export function AdminAccountMenu({ email }: { email: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
        {email}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<form action={logoutAction} className="w-full" />}
        >
          <Button
            type="submit"
            variant="ghost"
            className="h-auto w-full justify-start gap-2 p-0 font-normal"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Log out
          </Button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
