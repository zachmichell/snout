// Single source of truth for "which payment processor does this org use
// right now". Reads organizations.payment_processor and is the input to
// every checkout / capability decision in the app.
//
// Kept separate from useStripeConnect / useHelcim so consumers can ask
// just the routing question without paying the cost of the per-processor
// status fetches.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type ProcessorKind = "stripe" | "helcim";

export function useOrgProcessor() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: ["org-processor", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async (): Promise<ProcessorKind> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("payment_processor")
        .eq("id", membership!.organization_id)
        .maybeSingle();
      if (error) throw error;
      return (data?.payment_processor as ProcessorKind | undefined) ?? "stripe";
    },
  });
}
