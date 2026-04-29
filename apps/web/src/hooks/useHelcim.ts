// React Query hooks around the Helcim edge functions.
// Mirrors the shape of useStripeConnect so PaymentsTab can dispatch on
// the active processor with parallel call sites.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type HelcimAccount = {
  id: string;
  account_id: string | null;
  business_name: string | null;
  currency: "CAD" | "USD";
  charges_enabled: boolean;
  status: "pending" | "active" | "restricted";
  last_verified_at: string | null;
  last_verification_error: string | null;
  created_at: string;
} | null;

export type HelcimStatusResponse = {
  processor: "stripe" | "helcim";
  account: HelcimAccount;
};

/** Read the operator's Helcim attachment + processor flag. Cached. */
export function useHelcimStatus() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: ["helcim-status", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async (): Promise<HelcimStatusResponse> => {
      const { data, error } = await supabase.functions.invoke("helcim-account-status", {
        body: {},
      });
      if (error) throw error;
      return data as HelcimStatusResponse;
    },
  });
}

/** Force a live Helcim ping. Only run from the Settings tab on demand. */
export function useHelcimLiveCheck() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  return useMutation({
    mutationFn: async (): Promise<HelcimStatusResponse> => {
      const { data, error } = await supabase.functions.invoke("helcim-account-status", {
        body: { live: true },
      });
      if (error) throw error;
      return data as HelcimStatusResponse;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["helcim-status", membership?.organization_id] });
      qc.invalidateQueries({ queryKey: ["org-processor", membership?.organization_id] });
    },
  });
}

export function useAttachHelcim() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  return useMutation({
    mutationFn: async (vars: {
      api_token: string;
      account_label?: string;
      currency?: "CAD" | "USD";
      webhook_verifier?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("helcim-account-attach", {
        body: vars,
      });
      if (error) throw error;
      return data as {
        ok: boolean;
        processor: "helcim";
        currency: string;
        charges_enabled: boolean;
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["helcim-status", membership?.organization_id] });
      qc.invalidateQueries({ queryKey: ["org-processor", membership?.organization_id] });
    },
  });
}

export function useDetachHelcim() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("helcim-account-detach", {
        body: {},
      });
      if (error) throw error;
      return data as { ok: boolean; processor: "stripe" };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["helcim-status", membership?.organization_id] });
      qc.invalidateQueries({ queryKey: ["org-processor", membership?.organization_id] });
    },
  });
}
