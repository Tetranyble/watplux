import Image from "next/image";

import logo from "@/favicon/web-app-manifest-512x512.png";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative block size-9 shrink-0 overflow-hidden rounded-lg bg-brand-sun",
        className,
      )}
    >
      <Image src={logo} alt="" fill sizes="36px" className="object-cover" />
    </span>
  );
}
