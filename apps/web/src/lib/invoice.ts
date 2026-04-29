import { supabase } from "@/integrations/supabase/client";

/** Compute quantity for an invoice line based on the service duration type. */
export function computeQuantity(durationType: string | null | undefined, startISO: string, endISO: string): number {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const ms = Math.max(0, end.getTime() - start.getTime());
  const hours = ms / 3600000;
  const days = ms / 86400000;
  switch (durationType) {
    case "hourly":
      return Math.max(1, Math.ceil(hours));
    case "half_day":
    case "full_day":
      return 1;
    case "overnight":
      return 1;
    case "multi_night": {
      // Nights = number of midnights between start and end (min 1)
      const sd = new Date(start);
      sd.setHours(0, 0, 0, 0);
      const ed = new Date(end);
      ed.setHours(0, 0, 0, 0);
      const nights = Math.round((ed.getTime() - sd.getTime()) / 86400000);
      return Math.max(1, nights);
    }
    default:
      return 1;
  }
}

/**
 * Generate the next sequential invoice number for an org, e.g. INV-0001.
 * Delegates to an RPC that atomically bumps a per-org counter under a row
 * lock, so concurrent callers cannot collide. See migration
 * 20260424130100_atomic_invoice_numbering.sql.
 */
export async function nextInvoiceNumber(orgId: string): Promise<string> {
  const { data, error } = await supabase.rpc("next_invoice_number", { _org_id: orgId });
  if (error) throw error;
  if (!data) throw new Error("Failed to allocate invoice number");
  return data as string;
}

export type CreatedInvoice = {
  id: string;
  invoice_number: string | null;
  alreadyExisted: boolean;
};

/**
 * Idempotently create an invoice for a reservation.
 * Returns the existing invoice if one is already linked.
 */
export async function createInvoiceForReservation(reservationId: string): Promise<CreatedInvoice> {
  // Check existing
  const { data: existing, error: existErr } = await supabase
    .from("invoices")
    .select("id, invoice_number")
    .eq("reservation_id", reservationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existErr) throw existErr;
  if (existing) {
    return { id: existing.id, invoice_number: existing.invoice_number, alreadyExisted: true };
  }

  // Load reservation + service + pets
  const { data: r, error: rErr } = await supabase
    .from("reservations")
    .select(
      `id, organization_id, primary_owner_id, start_at, end_at,
       services(id, name, base_price_cents, duration_type),
       reservation_pets(pets(id, name))`,
    )
    .eq("id", reservationId)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!r) throw new Error("Reservation not found");
  if (!r.primary_owner_id) throw new Error("Reservation has no primary owner");
  const service: any = (r as any).services;
  if (!service) throw new Error("Reservation has no service");

  // Org currency
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("currency")
    .eq("id", r.organization_id)
    .maybeSingle();
  if (orgErr) throw orgErr;
  const currency = (org?.currency ?? "CAD") as "CAD" | "USD";

  const pets = ((r as any).reservation_pets ?? []).map((rp: any) => rp.pets).filter(Boolean) as {
    id: string;
    name: string;
  }[];
  const lineCount = Math.max(1, pets.length);
  const qty = computeQuantity(service.duration_type, r.start_at, r.end_at);
  const unit = service.base_price_cents ?? 0;
  const lineTotal = qty * unit;
  const subtotal = lineTotal * lineCount;

  const invoiceNumber = await nextInvoiceNumber(r.organization_id);
  const now = new Date();
  const due = new Date(now.getTime() + 14 * 86400000);

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({
      organization_id: r.organization_id,
      reservation_id: r.id,
      owner_id: r.primary_owner_id,
      currency,
      status: "draft",
      issued_at: now.toISOString(),
      due_at: due.toISOString(),
      invoice_number: invoiceNumber,
      subtotal_cents: subtotal,
      tax_cents: 0,
      total_cents: subtotal,
    })
    .select("id, invoice_number")
    .single();
  if (invErr) {
    // Another caller won the race (uniq_invoices_reservation_live). Re-read
    // and return the winner's invoice; our allocated number is discarded.
    //
    // EXPECTED SIDE EFFECT: gaps in the invoice number sequence. The counter
    // bump inside next_invoice_number() already committed, so the loser's
    // number (e.g. INV-0002) is permanently skipped. This is deliberate and
    // legally fine — invoice sequences require uniqueness, not contiguity.
    // Don't "fix" gaps by resetting the counter.
    if (invErr.code === "23505") {
      const { data: raced, error: racedErr } = await supabase
        .from("invoices")
        .select("id, invoice_number")
        .eq("reservation_id", reservationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (racedErr) throw racedErr;
      if (raced) {
        return { id: raced.id, invoice_number: raced.invoice_number, alreadyExisted: true };
      }
    }
    throw invErr;
  }

  // Insert one line per pet (or one generic line if no pets)
  const lines = (pets.length > 0 ? pets : [{ id: null, name: null }]).map((p) => ({
    organization_id: r.organization_id,
    invoice_id: inv.id,
    service_id: service.id,
    description: p.name ? `${service.name} — ${p.name}` : service.name,
    quantity: qty,
    unit_price_cents: unit,
    line_total_cents: qty * unit,
  }));
  const { error: linesErr } = await supabase.from("invoice_lines").insert(lines);
  if (linesErr) throw linesErr;

  // Activity log (best-effort)
  await supabase.from("activity_log").insert({
    organization_id: r.organization_id,
    entity_type: "invoice",
    entity_id: inv.id,
    action: "created",
    metadata: { reservation_id: r.id, invoice_number: invoiceNumber, total_cents: subtotal } as any,
  });

  return { id: inv.id, invoice_number: inv.invoice_number, alreadyExisted: false };
}

/** Display-only overdue check */
export function isOverdueDisplay(status: string | null | undefined, dueAt: string | null | undefined): boolean {
  if (status !== "sent") return false;
  if (!dueAt) return false;
  return new Date(dueAt) < new Date();
}

export type InvoiceDisplayStatus = "draft" | "sent" | "paid" | "overdue" | "void" | "partial";

export function effectiveInvoiceStatus(
  status: string | null | undefined,
  dueAt: string | null | undefined,
): InvoiceDisplayStatus {
  if (isOverdueDisplay(status, dueAt)) return "overdue";
  return (status as InvoiceDisplayStatus) ?? "draft";
}
