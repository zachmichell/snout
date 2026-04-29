import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOwnerRecord } from "./useOwnerRecord";

export function useOwnerInvoices() {
  const { data: owner } = useOwnerRecord();
  return useQuery({
    queryKey: ["owner-invoices-list", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          `id, invoice_number, status, issued_at, due_at, total_cents, amount_paid_cents, currency,
           reservation_id, reservations:reservation_id(id, start_at, services(name))`,
        )
        .eq("owner_id", owner!.id)
        .is("deleted_at", null)
        .not("status", "in", "(draft,void)")
        .order("issued_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useOwnerInvoice(id: string | undefined) {
  const { data: owner } = useOwnerRecord();
  return useQuery({
    queryKey: ["owner-invoice", id, owner?.id],
    enabled: !!id && !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          `id, invoice_number, status, issued_at, due_at, notes,
           subtotal_cents, tax_cents, total_cents, amount_paid_cents, currency,
           organization_id, owner_id, reservation_id,
           organizations:organization_id(id, name),
           owners:owner_id(id, first_name, last_name, email, phone, street_address, city, state_province, postal_code),
           reservations:reservation_id(id, start_at, end_at, location_id, services(name), locations:location_id(name, street_address, city, state_province, postal_code, phone, email)),
           invoice_lines(id, description, quantity, unit_price_cents, line_total_cents),
           invoice_taxes(id, name, rate_basis_points, amount_cents)`,
        )
        .eq("id", id!)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      // Access guard: must belong to current owner
      if (data && data.owner_id !== owner!.id) {
        throw new Error("forbidden");
      }
      return data;
    },
    retry: false,
  });
}
