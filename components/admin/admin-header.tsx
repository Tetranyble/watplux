import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

export function AdminHeader({
  mobileNavSlot,
  accountSlot,
}: {
  mobileNavSlot: React.ReactNode;
  accountSlot: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <div className="lg:hidden">{mobileNavSlot}</div>
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
          {accountSlot}
        </div>
      </div>
    </header>
  );
}
