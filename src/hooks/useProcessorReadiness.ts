// Processor-agnostic "can this org take a card payment right now?" check.
// Used by gating logic on invoice detail / POS so the "Send payment link"
// button only enables when the active processor has charges_enabled.
//
// Reads from whichever processor's account table the org points at,
// avoiding the prior pattern of every caller importing a Stripe-shaped
// hook and assuming Stripe everywhere.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type ProcessorReadiness = {
  processor: "stripe" | "helcim";
  charges_enabled: boolean;
  status: string | null;
};

export function useProcessorReadiness() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: ["processor-readiness", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async (): Promise<ProcessorReadiness> => {
      const orgId = membership!.organization_id;
      const { data: org } = await supabase
        .from("organizations")
        .select("payment_processor")
        .eq("id", orgId)
        .maybeSingle();
      const processor =
        (org?.payment_processor as "stripe" | "helcim" | undefined) ?? "stripe";

      if (processor === "helcim") {
        const { data } = await supabase
          .from("helcim_accounts")
          .select("charges_enabled, status")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .maybeSingle();
        return {
          processor,
          charges_enabled: !!data?.charges_enabled,
          status: data?.status ?? null,
        };
      }

      const { data } = await supabase
        .from("stripe_connect_accounts")
        .select("charges_enabled, status")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .maybeSingle();
      return {
        processor,
        charges_enabled: !!data?.charges_enabled,
        status: data?.status ?? null,
      };
    },
  });
}
