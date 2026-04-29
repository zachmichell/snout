import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OwnerBooking = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  notes: string | null;
  service_id: string | null;
  location_id: string | null;
  services: { name: string; duration_type: string } | null;
  locations: { name: string } | null;
  reservation_pets: { pets: { id: string; name: string } | null }[];
};

export function useOwnerBookings(ownerId: string | undefined) {
  return useQuery({
    queryKey: ["owner-bookings", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select(
          "id, start_at, end_at, status, notes, service_id, location_id, services(name, duration_type), locations(name), reservation_pets(pets(id, name))",
        )
        .eq("primary_owner_id", ownerId!)
        .is("deleted_at", null)
        .order("start_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OwnerBooking[];
    },
  });
}
