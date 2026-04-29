import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useLocations() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: ["locations", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name, active, timezone")
        .eq("organization_id", membership!.organization_id)
        .is("deleted_at", null)
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}
