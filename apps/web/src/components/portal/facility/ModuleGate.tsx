import { ReactNode } from "react";
import { useOrgModules } from "@/hooks/useOrgModules";
import PageHeader from "@/components/portal/PageHeader";
import PortalLayout from "@/components/portal/PortalLayout";
import type { Database } from "@/integrations/supabase/types";

type ModuleEnum = Database["public"]["Enums"]["module_enum"];

export default function ModuleGate({
  module,
  title,
  description,
  children,
}: {
  module: ModuleEnum;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { data: enabled, isLoading } = useOrgModules();

  if (isLoading) {
    return (
      <PortalLayout>
        <div className="px-8 py-6">
          <PageHeader title={title} description={description} />
          <div className="h-32 animate-pulse rounded-lg bg-surface" />
        </div>
      </PortalLayout>
    );
  }

  if (!enabled?.has(module)) {
    return (
      <PortalLayout>
        <div className="px-8 py-6">
          <PageHeader title={title} description={description} />
          <div className="rounded-lg border border-dashed border-border bg-surface p-12 text-center shadow-card">
            <div className="font-display text-lg text-foreground">Module not active</div>
            <p className="mt-1 text-sm text-text-secondary">
              The {module} module is not active for your organization. Contact support to enable it.
            </p>
          </div>
        </div>
      </PortalLayout>
    );
  }

  return <>{children}</>;
}
