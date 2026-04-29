import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useOwnerRecord() {
  const { user, membership } = useAuth();
  return useQuery({
    queryKey: ["owner-record", user?.id, membership?.organization_id],
    enabled: !!user?.id && !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owners")
        .select("*")
        .eq("profile_id", user!.id)
        .eq("organization_id", membership!.organization_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
