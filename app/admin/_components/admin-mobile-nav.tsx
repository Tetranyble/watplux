"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Boxes,
  ClipboardList,
  ExternalLink,
  Gauge,
  LogOut,
  Menu,
  PackageSearch,
  ReceiptText,
  Settings,
  ShoppingBag,
  Users,
} from "lucide-react";

import { logoutAction } from "@/app/(storefront)/account/actions";
import { BrandMark } from "@/components/brand/brand-mark";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const ICONS = {
  "/admin": Gauge,
  "/admin/catalog/products": Boxes,
  "/admin/inventory": PackageSearch,
  "/admin/orders": ShoppingBag,
  "/admin/payments": ReceiptText,
  "/admin/service-requests": ClipboardList,
  "/admin/customers": Users,
} as const;

function initials(name: string, email: string) {
  const value = name.trim() || email.split("@")[0] || "User";
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function isActive(pathname: string, href: string) {
  return href === "/admin"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminMobileNav({
  links,
  name,
  email,
  image,
}: {
  links: Array<{ href: string; label: string }>;
  name: string;
  email: string;
  image: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const fallback = initials(name, email);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open operations menu"
          />
        }
      >
        <Menu aria-hidden="true" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(88vw,20rem)] gap-0 bg-background text-foreground"
      >
        <SheetHeader className="border-b px-4 py-4 pr-12">
          <SheetTitle className="flex items-center gap-3 text-left">
            <BrandMark className="size-9" />
            <span>
              <span className="block text-sm font-semibold">Watplux Ops</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Operations workspace
              </span>
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Workspace
          </p>
          <nav aria-label="Operations" className="grid gap-1">
            {links.map((link) => {
              const Icon = ICONS[link.href as keyof typeof ICONS] ?? Gauge;
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-muted text-foreground",
                  )}
                  onClick={() => setOpen(false)}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <SheetFooter className="gap-3 border-t p-3">
          <div className="flex items-center gap-3 px-2 py-1">
            <Avatar className="size-9 ring-1 ring-border">
              {image ? <AvatarImage src={image} alt="" /> : null}
              <AvatarFallback>{fallback}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/account" />}
              onClick={() => setOpen(false)}
            >
              <Settings aria-hidden="true" />
              Account
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/" />}
              onClick={() => setOpen(false)}
            >
              <ExternalLink aria-hidden="true" />
              Storefront
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
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
