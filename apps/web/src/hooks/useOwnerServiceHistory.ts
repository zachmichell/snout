import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOwnerRecord } from "./useOwnerRecord";

export type OwnerHistoryEntry = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  notes: string | null;
  service_id: string | null;
  location_id: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  checked_out_by_user_id: string | null;
  services: { name: string; duration_type: string; module: string } | null;
  locations: { name: string } | null;
  reservation_pets: { pets: { id: string; name: string } | null }[];
  staff_profile?: { first_name: string | null; last_name: string | null } | null;
  report_card?: { id: string; published: boolean } | null;
};

export function useOwnerServiceHistory(ownerId: string | undefined) {
  return useQuery({
    queryKey: ["owner-service-history", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select(
          `id, start_at, end_at, status, notes, service_id, location_id,
           checked_in_at, checked_out_at, checked_out_by_user_id,
           services(name, duration_type, module),
           locations(name),
           reservation_pets(pets(id, name))`,
        )
        .eq("primary_owner_id", ownerId!)
        .is("deleted_at", null)
        .in("status", ["checked_out", "checked_in", "cancelled", "no_show"])
        .order("start_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      const reservations = (data ?? []) as any[];

      // Fetch staff profiles in one shot
      const staffIds = Array.from(
        new Set(reservations.map((r) => r.checked_out_by_user_id).filter(Boolean)),
      ) as string[];
      const reservationIds = reservations.map((r) => r.id);

      const [staffRes, cardsRes] = await Promise.all([
        staffIds.length
          ? supabase.from("profiles").select("id, first_name, last_name").in("id", staffIds)
          : Promise.resolve({ data: [], error: null } as any),
        reservationIds.length
          ? supabase
              .from("report_cards")
              .select("id, reservation_id, published")
              .in("reservation_id", reservationIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      if (staffRes.error) throw staffRes.error;
      if (cardsRes.error) throw cardsRes.error;

      const staffById = new Map<string, any>((staffRes.data ?? []).map((p: any) => [p.id, p]));
      const cardByRes = new Map<string, any>(
        (cardsRes.data ?? []).map((c: any) => [c.reservation_id, c]),
      );

      return reservations.map((r) => ({
        ...r,
        staff_profile: r.checked_out_by_user_id ? staffById.get(r.checked_out_by_user_id) ?? null : null,
        report_card: cardByRes.get(r.id) ?? null,
      })) as OwnerHistoryEntry[];
    },
  });
}
