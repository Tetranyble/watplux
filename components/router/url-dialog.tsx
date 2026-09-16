"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function useUrlDialog(key: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get("dialog");

  function href(extra?: Record<string, string | null | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("dialog", key);
    for (const [name, value] of Object.entries(extra ?? {})) {
      if (value == null || value === "") params.delete(name);
      else params.set(name, value);
    }
    return `${pathname}?${params.toString()}`;
  }

  function open(extra?: Record<string, string | null | undefined>) {
    router.push(href(extra), { scroll: false });
  }

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("dialog");
    params.delete("item");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  return { isOpen: active === key, active, open, close, href, searchParams };
}

export function UrlDialog({
  dialogKey,
  title,
  description,
  children,
  className,
}: {
  dialogKey: string;
  title: ReactNode;
  description?: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const dialog = useUrlDialog(dialogKey);

  return (
    <Dialog
      open={dialog.isOpen}
      onOpenChange={(open) => !open && dialog.close()}
    >
      {dialog.isOpen ? (
        <DialogContent
          className={cn(
            "max-h-[min(88vh,760px)] overflow-y-auto sm:max-w-xl",
            className,
          )}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          {children(dialog.close)}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
