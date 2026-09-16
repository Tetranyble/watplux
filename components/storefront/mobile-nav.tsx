"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, MessageSquareText, ShoppingBag, Wrench } from "lucide-react";

import { BrandMark } from "@/components/brand/brand-mark";
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

export interface NavLink {
  href: string;
  label: string;
  description?: string;
}

const ICONS = {
  "/products": ShoppingBag,
  "/consultation": MessageSquareText,
  "/installation": Wrench,
} as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Pure presentational mobile navigation trigger — receives its link list
 * and any account/cart slots as props/children (docs/PHASE_9_STOREFRONT_PLAN.md
 * §6), never fetches session/cart data itself: `components/**` is
 * forbidden from importing use-cases (eslint.config.mjs boundaries).
 */
export function MobileNav({
  links,
  accountSlot,
}: {
  links: NavLink[];
  accountSlot?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open menu"
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
              <span className="block text-sm font-semibold">Watplux</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Solar shop &amp; services
              </span>
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Explore
          </p>
          <nav aria-label="Mobile" className="grid gap-1">
            {links.map((link) => {
              const Icon =
                ICONS[link.href as keyof typeof ICONS] ?? ShoppingBag;
              const active = isActive(pathname, link.href);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-start gap-3 rounded-control px-3 py-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-muted text-foreground",
                  )}
                  onClick={() => setOpen(false)}
                >
                  <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {link.label}
                    </span>
                    {link.description ? (
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {link.description}
                      </span>
                    ) : null}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        {accountSlot ? (
          <SheetFooter
            className="gap-3 border-t p-4"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a, button")) {
                setOpen(false);
              }
            }}
          >
            {accountSlot}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
