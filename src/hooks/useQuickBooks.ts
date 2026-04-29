// React Query hooks around the QuickBooks Online edge functions.
// Mirrors the shape of useStripeConnect / useHelcim so the settings UI
// can look at the connection in a consistent way.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type QuickBooksAccount = {
  id: string;
  realm_id: string;
  company_name: string | null;
  environment: "sandbox" | "production";
  status: "pending" | "active" | "restricted";
  last_verified_at: string | null;
  last_verification_error: string | null;
  access_token_expires_at: string | null;
  created_at: string;
} | null;

export type QuickBooksStatusResponse = {
  account: QuickBooksAccount;
  live_check?: { ok: boolean; reason?: string; error?: string; company_name?: string | null };
};

export function useQuickBooksStatus() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: ["quickbooks-status", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async (): Promise<QuickBooksStatusResponse> => {
      const { data, error } = await supabase.functions.invoke("quickbooks-account-status", {
        body: {},
      });
      if (error) throw error;
      return data as QuickBooksStatusResponse;
    },
  });
}

/** Trigger a live ping against Intuit. Refreshes the access token if needed. */
export function useQuickBooksLiveCheck() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  return useMutation({
    mutationFn: async (): Promise<QuickBooksStatusResponse> => {
      const { data, error } = await supabase.functions.invoke("quickbooks-account-status", {
        body: { live: true },
      });
      if (error) throw error;
      return data as QuickBooksStatusResponse;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quickbooks-status", membership?.organization_id] });
    },
  });
}

/** Returns the URL the user should be sent to to begin the OAuth dance. */
export function useStartQuickBooksOnboarding() {
  return useMutation({
    mutationFn: async (returnTo?: string) => {
      const { data, error } = await supabase.functions.invoke("quickbooks-auth-start", {
        body: { return_to: returnTo },
      });
      if (error) throw error;
      return data as { url: string; state: string };
    },
  });
}

export function useDetachQuickBooks() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("quickbooks-account-detach", {
        body: {},
      });
      if (error) throw error;
      return data as { ok: boolean; revoke_attempted: boolean; revoke_error: string | null };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quickbooks-status", membership?.organization_id] });
    },
  });
}
