import { BrandMark } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/lib/site-config";

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <BrandMark />
      <span className="sr-only">{siteConfig.name}</span>
    </span>
  );
}
