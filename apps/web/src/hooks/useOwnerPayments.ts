import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOwnerRecord } from "./useOwnerRecord";

export type OwnerPayment = {
  id: string;
  invoice_id: string;
  amount_cents: number;
  currency: string;
  method: string;
  status: string;
  processed_at: string | null;
  created_at: string;
  invoices: {
    id: string;
    invoice_number: string | null;
    owner_id: string;
    total_cents: number;
    reservations: { services: { name: string } | null } | null;
  } | null;
};

export function useOwnerPayments() {
  const { data: owner } = useOwnerRecord();
  return useQuery({
    queryKey: ["owner-payments", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          `id, invoice_id, amount_cents, currency, method, status, processed_at, created_at,
           invoices!inner(id, invoice_number, owner_id, total_cents,
             reservations:reservation_id(services(name)))`,
        )
        .eq("invoices.owner_id", owner!.id)
        .is("deleted_at", null)
        .order("processed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as OwnerPayment[];
    },
  });
}
