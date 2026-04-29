import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type GroomingAppointment = {
  id: string;
  organization_id: string;
  reservation_id: string | null;
  pet_id: string;
  owner_id: string;
  groomer_id: string;
  appointment_date: string;
  start_time: string;
  estimated_duration_minutes: number;
  services_requested: string[];
  price_cents: number;
  notes: string | null;
  status: string;
  check_in_time: string | null;
  completed_time: string | null;
  created_at: string;
  updated_at: string;
  pet?: { id: string; name: string } | null;
  owner?: { id: string; first_name: string; last_name: string } | null;
  groomer?: { id: string; display_name: string } | null;
};

export function useGroomingAppointments(date: string | undefined) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  return useQuery({
    queryKey: ["grooming-appointments", orgId, date],
    enabled: !!orgId && !!date,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grooming_appointments")
        .select(
          "*, pet:pets(id,name), owner:owners(id,first_name,last_name), groomer:groomers(id,display_name)"
        )
        .eq("organization_id", orgId!)
        .eq("appointment_date", date!)
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as unknown as GroomingAppointment[];
    },
  });
}
