import { SunMedium, Zap } from "lucide-react";

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/15",
        className,
      )}
    >
      <SunMedium className="absolute size-5 opacity-45" />
      <Zap className="relative size-4 fill-current" />
    </span>
  );
}
