import { Inbox, type LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

export function AdminEmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      action={action}
      icon={Icon}
      className={className}
    />
  );
}
