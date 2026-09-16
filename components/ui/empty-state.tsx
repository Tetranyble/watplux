import { Inbox, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex min-h-72 flex-1 flex-col items-center justify-center px-6 py-12 text-center",
        className,
      )}
    >
      <div
        data-slot="empty-state-icon"
        className="mb-4 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"
      >
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <h2 data-slot="empty-state-title" className="text-lg font-semibold">
        {title}
      </h2>
      {description ? (
        <p
          data-slot="empty-state-description"
          className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground"
        >
          {description}
        </p>
      ) : null}
      {action ? (
        <div data-slot="empty-state-action" className="mt-6">
          {action}
        </div>
      ) : null}
    </div>
  );
}

export { EmptyState };
