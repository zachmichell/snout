import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function usePetFeeding(petId: string | undefined, includeInactive = false) {
  return useQuery({
    queryKey: ["pet-feeding", petId, includeInactive],
    enabled: !!petId,
    queryFn: async () => {
      let q = supabase.from("pet_feeding_schedules").select("*").eq("pet_id", petId!);
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
