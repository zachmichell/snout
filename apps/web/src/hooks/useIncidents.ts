import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { IncidentSeverity, IncidentType } from "@/lib/incidents";

export type IncidentFilters = {
  organizationId?: string;
  from?: string; // ISO
  to?: string; // ISO
  severity?: IncidentSeverity | "all";
  type?: IncidentType | "all";
  followUpOnly?: boolean;
};

const INCIDENT_WITH_PETS = `
  *,
  reporter:reported_by(first_name, last_name),
  incident_pets(id, pet_id, role, injury_description, pets(id, name, species, photo_url))
`;

export function useIncidents(filters: IncidentFilters) {
  return useQuery({
    queryKey: ["incidents", filters],
    enabled: !!filters.organizationId,
    queryFn: async () => {
      let q = supabase
        .from("incidents")
        .select(INCIDENT_WITH_PETS)
        .eq("organization_id", filters.organizationId!)
        .order("incident_at", { ascending: false });

      if (filters.from) q = q.gte("incident_at", filters.from);
      if (filters.to) q = q.lte("incident_at", filters.to);
      if (filters.severity && filters.severity !== "all") q = q.eq("severity", filters.severity);
      if (filters.type && filters.type !== "all") q = q.eq("incident_type", filters.type);
      if (filters.followUpOnly) {
        q = q.eq("follow_up_required", true).is("follow_up_completed_at", null);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useIncident(id: string | undefined) {
  return useQuery({
    queryKey: ["incident", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incidents")
        .select(INCIDENT_WITH_PETS + ", locations(name, timezone), reservations(id, start_at, services(name))")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function usePetIncidents(petId: string | undefined) {
  return useQuery({
    queryKey: ["pet-incidents", petId],
    enabled: !!petId,
    queryFn: async () => {
      // Get incident_ids involving this pet, then fetch the incidents.
      const { data: links, error: linkErr } = await supabase
        .from("incident_pets")
        .select("incident_id, role, injury_description")
        .eq("pet_id", petId!);
      if (linkErr) throw linkErr;
      const ids = (links ?? []).map((l) => l.incident_id);
      if (!ids.length) return [];

      const { data, error } = await supabase
        .from("incidents")
        .select(INCIDENT_WITH_PETS)
        .in("id", ids)
        .order("incident_at", { ascending: false });
      if (error) throw error;

      const linkMap = new Map(
        (links ?? []).map((l) => [l.incident_id, { role: l.role, injury: l.injury_description }]),
      );
      return (data ?? []).map((inc) => ({
        ...inc,
        _thisPetRole: linkMap.get(inc.id)?.role,
        _thisPetInjury: linkMap.get(inc.id)?.injury,
      }));
    },
  });
}

export function useReservationIncidents(reservationId: string | undefined) {
  return useQuery({
    queryKey: ["reservation-incidents", reservationId],
    enabled: !!reservationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incidents")
        .select(INCIDENT_WITH_PETS)
        .eq("reservation_id", reservationId!)
        .order("incident_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
