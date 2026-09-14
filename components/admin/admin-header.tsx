import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { visibleAdminNavLinks } from "@/components/admin/admin-nav-links";
import { MobileNav } from "@/components/storefront/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export function AdminHeader({
  permissions,
  accountSlot,
}: {
  permissions: ReadonlySet<string>;
  accountSlot: React.ReactNode;
}) {
  const links = visibleAdminNavLinks(permissions);
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <div className="lg:hidden">
          <MobileNav links={links} />
        </div>
        <div className="lg:hidden">
          <Link href="/admin" className="font-semibold tracking-tight">
            Watplux Ops
          </Link>
        </div>
        <div className="hidden lg:block">
          <p className="text-xs font-semibold text-muted-foreground">
            Operations workspace
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/" />}
          >
            <ExternalLink className="size-4" />
            Storefront
          </Button>
          {accountSlot}
        </div>
      </div>
    </header>
  );
}
