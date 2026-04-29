import PortalLayout from "@/components/portal/PortalLayout";
import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
}

export default function PlaceholderPage({
  title,
  description = "This feature is under development.",
  icon: Icon = Sparkles,
}: PlaceholderPageProps) {
  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <header className="mb-6">
          <h1 className="font-display text-2xl text-foreground">{title}</h1>
        </header>
        <div className="rounded-lg border border-dashed border-border bg-surface p-16 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Icon className="h-7 w-7" />
          </div>
          <div className="font-display text-xl text-foreground">Coming Soon</div>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">{description}</p>
        </div>
      </div>
    </PortalLayout>
  );
}
