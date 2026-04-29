import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function usePetTraits(petId: string | undefined) {
  return useQuery({
    queryKey: ["pet-traits", petId],
    enabled: !!petId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_traits")
        .select("*")
        .eq("pet_id", petId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
