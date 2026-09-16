import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/(storefront)/account/actions";
import { Button } from "@/components/ui/button";

export function AdminSidebarSignOut() {
  return (
    <form action={logoutAction}>
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </form>
  );
}
