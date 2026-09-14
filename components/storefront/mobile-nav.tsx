"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export interface NavLink {
  href: string;
  label: string;
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
      <SheetContent side="left" className="w-72">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2 py-2 text-sm font-medium hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {accountSlot ? (
          <div className="mt-4 border-t px-4 pt-4">{accountSlot}</div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
