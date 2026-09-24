import Link from "next/link";

import { cn } from "@/lib/utils";
import { SITE_COPY_SECTIONS } from "@/src/modules/site-copy/sections";

export function ContentSubNav({ active }: { active: string }) {
  return (
    <nav
      aria-label="Website copy sections"
      className="overflow-x-auto border-b"
    >
      <div className="flex min-w-max gap-4 px-0.5 text-sm">
        {SITE_COPY_SECTIONS.map((section) => {
          const href = `/admin/content/${section.namespace}`;
          const current = active === section.namespace;

          return (
            <Link
              key={section.namespace}
              href={href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "border-b-2 border-transparent pb-3 font-medium text-muted-foreground transition-colors hover:text-foreground",
                current && "border-primary text-foreground",
              )}
            >
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
