import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

type ModuleEnum = Database["public"]["Enums"]["module_enum"];

/** Returns the set of enabled modules for the current org. */
export function useOrgModules() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: ["org-modules", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_modules")
        .select("module, enabled")
        .eq("organization_id", membership!.organization_id)
        .is("deleted_at", null)
        .eq("enabled", true);
      if (error) throw error;
      const enabled = new Set<ModuleEnum>((data ?? []).map((r) => r.module as ModuleEnum));
      return enabled;
    },
  });
}
