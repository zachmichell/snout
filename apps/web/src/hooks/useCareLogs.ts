import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Care logs for an organization on a given local date (YYYY-MM-DD).
// We compute UTC bounds for that calendar day in the local TZ of the browser
// (acceptable for staff portal — staff typically operate in the org's timezone).
export function useOrgCareLogs(orgId: string | undefined, dateISO: string) {
  return useQuery({
    queryKey: ["org-care-logs", orgId, dateISO],
    enabled: !!orgId,
    queryFn: async () => {
      const start = new Date(`${dateISO}T00:00:00`);
      const end = new Date(`${dateISO}T23:59:59.999`);
      const { data, error } = await supabase
        .from("pet_care_logs")
        .select(
          "*, pets(id, name, species, photo_url), profiles:logged_by(first_name, last_name)",
        )
        .eq("organization_id", orgId!)
        .gte("logged_at", start.toISOString())
        .lte("logged_at", end.toISOString())
        .order("logged_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useReservationCareLogs(reservationId: string | undefined) {
  return useQuery({
    queryKey: ["reservation-care-logs", reservationId],
    enabled: !!reservationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_care_logs")
        .select("*, profiles:logged_by(first_name, last_name)")
        .eq("reservation_id", reservationId!)
        .order("logged_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
