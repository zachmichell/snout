import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type SuiteRow = {
  id: string;
  name: string;
  type: "standard" | "deluxe" | "presidential";
  capacity: number;
  daily_rate_cents: number;
  status: "active" | "inactive";
  location_id: string | null;
};

export function useSuites(opts?: { activeOnly?: boolean }) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  return useQuery({
    queryKey: ["suites", orgId, opts?.activeOnly ?? false],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from("suites")
        .select("id, name, type, capacity, daily_rate_cents, status, location_id")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("name");
      if (opts?.activeOnly) q = q.eq("status", "active");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SuiteRow[];
    },
  });
}
