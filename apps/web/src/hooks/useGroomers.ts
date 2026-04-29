import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type Groomer = {
  id: string;
  organization_id: string;
  staff_member_id: string | null;
  display_name: string;
  specialties: string[];
  certifications: string[];
  commission_rate_percent: number | null;
  max_appointments_per_day: number;
  working_days: string[];
  bio: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export function useGroomers(opts: { activeOnly?: boolean } = {}) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  return useQuery({
    queryKey: ["groomers", orgId, opts.activeOnly ?? false],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from("groomers")
        .select("*")
        .eq("organization_id", orgId!)
        .order("display_name");
      if (opts.activeOnly) q = q.eq("status", "active");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Groomer[];
    },
  });
}
