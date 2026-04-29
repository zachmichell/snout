import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type PaymentMethod = {
  id: string;
  organization_id: string;
  owner_id: string;
  card_brand: string;
  card_last_four: string;
  expiry_month: number;
  expiry_year: number;
  is_default: boolean;
  stripe_payment_method_id: string | null;
  created_at: string;
};

export function usePaymentMethods(ownerId: string | undefined) {
  return useQuery({
    queryKey: ["payment-methods", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("*")
        .eq("owner_id", ownerId!)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PaymentMethod[];
    },
  });
}

export function useCreatePaymentMethod() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      owner_id: string;
      card_brand: string;
      card_last_four: string;
      expiry_month: number;
      expiry_year: number;
      is_default: boolean;
    }) => {
      if (!membership?.organization_id) throw new Error("Missing organization");
      // If new card is default, clear other defaults first
      if (input.is_default) {
        await supabase
          .from("payment_methods")
          .update({ is_default: false })
          .eq("owner_id", input.owner_id)
          .eq("is_default", true);
      }
      const { data, error } = await supabase
        .from("payment_methods")
        .insert({
          ...input,
          organization_id: membership.organization_id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as PaymentMethod;
    },
    onSuccess: (_d, vars) => {
      toast.success("Card saved");
      qc.invalidateQueries({ queryKey: ["payment-methods", vars.owner_id] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save card"),
  });
}

export function useSetDefaultPaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; owner_id: string }) => {
      // Clear existing default
      await supabase
        .from("payment_methods")
        .update({ is_default: false })
        .eq("owner_id", input.owner_id)
        .eq("is_default", true);
      const { error } = await supabase
        .from("payment_methods")
        .update({ is_default: true })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success("Default card updated");
      qc.invalidateQueries({ queryKey: ["payment-methods", vars.owner_id] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
}

export function useDeletePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; owner_id: string }) => {
      const { error } = await supabase
        .from("payment_methods")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success("Card removed");
      qc.invalidateQueries({ queryKey: ["payment-methods", vars.owner_id] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
}
