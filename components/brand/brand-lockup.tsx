import { BrandMark } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/lib/site-config";

export function BrandLockup({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark />
      {!compact ? (
        <span className="leading-none">
          <span className="block text-[15px] font-bold tracking-tight text-foreground">
            {siteConfig.name}
          </span>
          <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Solar &amp; Energy
          </span>
        </span>
      ) : null}
    </span>
  );
}
