import { BrandMark } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";

export function BrandLockup({
  className,
  siteName,
}: {
  className?: string;
  siteName: string;
}) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <BrandMark />
      <span className="sr-only">{siteName}</span>
    </span>
  );
}
