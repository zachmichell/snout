import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useReportCard(reservationId: string | undefined, petId: string | undefined) {
  return useQuery({
    queryKey: ["report-card", reservationId, petId],
    enabled: !!reservationId && !!petId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_cards")
        .select("*")
        .eq("reservation_id", reservationId!)
        .eq("pet_id", petId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useOwnerReportCards(ownerId: string | undefined) {
  return useQuery({
    queryKey: ["owner-report-cards", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      // Find pet IDs the owner owns
      const { data: links, error: e1 } = await supabase
        .from("pet_owners")
        .select("pet_id")
        .eq("owner_id", ownerId!);
      if (e1) throw e1;
      const petIds = (links ?? []).map((l: any) => l.pet_id);
      if (!petIds.length) return [];

      const { data, error } = await supabase
        .from("report_cards")
        .select(
          "*, pets(id, name, species, photo_url), reservations(id, start_at, services(name))",
        )
        .eq("published", true)
        .in("pet_id", petIds)
        .order("published_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useOwnerReportCard(id: string | undefined, ownerId: string | undefined) {
  return useQuery({
    queryKey: ["owner-report-card", id, ownerId],
    enabled: !!id && !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_cards")
        .select(
          "*, pets(id, name, species, photo_url), reservations(id, start_at, end_at, services(name), locations(timezone, name))",
        )
        .eq("id", id!)
        .eq("published", true)
        .maybeSingle();
      if (error) throw error;
      // Verify pet belongs to this owner
      if (data) {
        const { data: link } = await supabase
          .from("pet_owners")
          .select("id")
          .eq("pet_id", (data as any).pet_id)
          .eq("owner_id", ownerId!)
          .maybeSingle();
        if (!link) return null;
      }
      return data;
    },
  });
}
