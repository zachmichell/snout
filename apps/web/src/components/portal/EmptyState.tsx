import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center shadow-card">
      {Icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-light text-primary">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <div className="font-display text-lg text-foreground">{title}</div>
      {description && <p className="mt-1 max-w-sm text-sm text-text-secondary">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
