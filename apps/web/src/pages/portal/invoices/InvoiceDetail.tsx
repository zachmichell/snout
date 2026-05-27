import { useEffect, useState } from "react";
import { toArray } from "@/lib/postgrest";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, CheckCircle2, Ban, Link2, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import InvoiceStatusBadge from "@/components/portal/InvoiceStatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatCentsShort, formatDateTime } from "@/lib/money";
import { effectiveInvoiceStatus } from "@/lib/invoice";
import { useCreateCheckoutSession } from "@/hooks/useStripeConnect";
import { useProcessorReadiness } from "@/hooks/useProcessorReadiness";
import { sendInvoiceCreated } from "@/lib/email";
import { usePermissions } from "@/hooks/usePermissions";
import { pgErrorToMessage, isStaleStateError } from "@/lib/db-errors";

export default function InvoiceDetail() {
  const { can } = usePermissions();
  const canSendPerm = can("invoices.send");
  const canEditPerm = can("invoices.edit");
  const { id } = useParams();
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [refundFor, setRefundFor] = useState<{
    id: string;
    amount_cents: number;
    currency: string;
  } | null>(null);
  const canRefundPerm = can("invoices.refund") || can("invoices.edit");

  const { data: inv, isLoading } = useQuery({
    queryKey: ["invoice", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          `id, invoice_number, status, issued_at, due_at, paid_at, currency, notes,
           subtotal_cents, tax_cents, total_cents, reservation_id, organization_id,
           owners:owner_id(id, first_name, last_name, email, phone),
           reservations:reservation_id(
             id, start_at, end_at,
             services(name),
             locations(name, street_address, city, state_province, postal_code),
             reservation_pets(pets(id, name))
           ),
           invoice_lines(id, description, quantity, unit_price_cents, line_total_cents)`,
        )
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: org } = useQuery({
    queryKey: ["invoice-org", inv?.organization_id],
    enabled: !!inv?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("name, timezone")
        .eq("id", inv!.organization_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Payments live on a separate row set from the invoice. We fetch them
  // alongside the invoice so the right-rail can show "$X charged on a
  // credit card, expected to land in your bank on ...". The expected
  // payout date comes from the Stripe webhook (balance transaction's
  // available_on), and is only present for card payments where Stripe
  // surfaced the field.
  const { data: payments } = useQuery({
    queryKey: ["invoice-payments", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, method, amount_cents, currency, status, processed_at, created_at, card_funding, expected_payout_at, stripe_payment_intent_id",
        )
        .eq("invoice_id", id!)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (inv && !notesDirty) setNotes(inv.notes ?? "");
  }, [inv, notesDirty]);

  // State-guarded transitions. Each mutate() call passes the set of DB
  // statuses the transition is valid from; if the row isn't in one of
  // those states (because a concurrent writer — e.g. a Stripe webhook —
  // already moved it), the UPDATE affects zero rows and we fail loud
  // instead of blindly overwriting paid/void state.
  const statusMut = useMutation({
    mutationFn: async (vars: {
      patch: Record<string, any>;
      allowedFrom: Array<"draft" | "sent" | "partial" | "paid" | "void" | "overdue">;
    }) => {
      const { data, error } = await supabase
        .from("invoices")
        .update(vars.patch as any)
        .eq("id", id!)
        .in("status", vars.allowedFrom)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Invoice state changed — refresh and try again.");
      }
      // Activity log
      if (inv) {
        await supabase.from("activity_log").insert({
          organization_id: inv.organization_id,
          entity_type: "invoice",
          entity_id: inv.id,
          action: `status_${vars.patch.status}`,
          metadata: vars.patch as any,
        });
      }
    },
    onSuccess: (_d, vars) => {
      toast.success(`Invoice ${vars.patch.status}`);
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      qc.invalidateQueries({ queryKey: ["invoices-list"] });
      // Send invoice email when status transitions to "sent"
      if (vars.patch.status === "sent" && inv) {
        const owner: any = (inv as any).owners;
        if (owner?.email && inv.organization_id) {
          sendInvoiceCreated({
            organization_id: inv.organization_id,
            to: owner.email,
            invoice_number: inv.invoice_number ?? inv.id.slice(0, 8),
            amount_display: `${formatCentsShort(inv.total_cents)} ${inv.currency}`,
            due_date: formatDateTime(inv.due_at, org?.timezone),
            invoice_id: inv.id,
            owner_id: owner.id,
          }).catch((e) => console.warn("invoice email failed:", e));
        }
      }
    },
    onError: (e: any) => {
      toast.error(pgErrorToMessage(e, "Update failed"));
      if (isStaleStateError(e)) {
        qc.invalidateQueries({ queryKey: ["invoice", id] });
      }
    },
  });

  // Mark Paid goes through an RPC so the status flip + offline payments
  // row land atomically. Without this, SUM(payments) could diverge from
  // invoices.amount_paid_cents when a partial Stripe credit existed before
  // staff collected the remainder in cash.
  const markPaidMut = useMutation({
    mutationFn: async (method: "in_person" | "ach" | "card" = "in_person") => {
      const { error } = await supabase.rpc("mark_invoice_paid_offline", {
        invoice_id: id!,
        method,
      });
      if (error) throw error;
      if (inv) {
        await supabase.from("activity_log").insert({
          organization_id: inv.organization_id,
          entity_type: "invoice",
          entity_id: inv.id,
          action: "status_paid",
          metadata: { method, source: "offline" } as any,
        });
      }
    },
    onSuccess: () => {
      toast.success("Invoice marked paid");
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      qc.invalidateQueries({ queryKey: ["invoices-list"] });
    },
    onError: (e: any) => {
      toast.error(pgErrorToMessage(e, "Mark paid failed"));
      if (isStaleStateError(e)) {
        qc.invalidateQueries({ queryKey: ["invoice", id] });
      }
    },
  });

  // Hoisted above the early returns so React's hook order stays
  // consistent across renders (Rules of Hooks). These hooks don't
  // depend on `inv` having loaded yet — they read membership/session
  // state from their own sources.
  const readiness = useProcessorReadiness();
  const checkout = useCreateCheckoutSession();

  const saveNotes = async () => {
    const { error } = await supabase.from("invoices").update({ notes }).eq("id", id!);
    if (error) return toast.error(error.message);
    if (inv) {
      const { logActivity } = await import("@/lib/activity");
      await logActivity({
        organization_id: inv.organization_id,
        action: "notes_updated",
        entity_type: "invoice",
        entity_id: inv.id,
      });
    }
    toast.success("Notes saved");
    setNotesDirty(false);
    qc.invalidateQueries({ queryKey: ["invoice", id] });
  };

  if (isLoading) {
    return (
      <PortalLayout>
        <div className="p-8 text-sm text-text-secondary">Loading…</div>
      </PortalLayout>
    );
  }
  if (!inv) {
    return (
      <PortalLayout>
        <div className="p-8 text-sm text-text-secondary">Invoice not found.</div>
      </PortalLayout>
    );
  }

  const eff = effectiveInvoiceStatus(inv.status, inv.due_at);
  const tz = org?.timezone || undefined;
  const lines = (inv as any).invoice_lines ?? [];
  const reservation: any = (inv as any).reservations;
  const owner: any = (inv as any).owners;
  const location: any = reservation?.locations;
  const pets: any[] = toArray((reservation as any)?.reservation_pets).map((rp: any) => rp.pets).filter(Boolean);

  const canSendPaymentLink =
    (inv.status === "sent" || eff === "overdue" || inv.status === "partial") &&
    !!readiness.data?.charges_enabled;

  const sendPaymentLink = async () => {
    try {
      const res = await checkout.mutateAsync(inv.id);
      try {
        await navigator.clipboard.writeText(res.checkout_url);
        toast.success("Payment link copied to clipboard");
      } catch {
        toast.success("Payment link created", { description: res.checkout_url });
      }
      qc.invalidateQueries({ queryKey: ["invoice", id] });
    } catch (e: any) {
      toast.error(pgErrorToMessage(e, "Could not create payment link"));
    }
  };

  const renderActions = () => {
    const canSend = inv.status === "draft" && canSendPerm;
    const canMarkPaid = (inv.status === "sent" || eff === "overdue" || inv.status === "partial") && canEditPerm;
    const canVoid = (inv.status === "draft" || inv.status === "sent" || eff === "overdue") && canEditPerm;
    const showPayLink = canSendPaymentLink && canSendPerm;
    return (
      <>
        {canSend && (
          <Button onClick={() => statusMut.mutate({ patch: { status: "sent" }, allowedFrom: ["draft"] })}>
            <Send className="h-4 w-4" /> Send
          </Button>
        )}
        {showPayLink && (
          <Button
            variant="outline"
            onClick={sendPaymentLink}
            disabled={checkout.isPending}
          >
            <Link2 className="h-4 w-4" />
            {checkout.isPending ? "Generating…" : "Send payment link"}
          </Button>
        )}
        {canMarkPaid && (
          <Button
            onClick={() => markPaidMut.mutate("in_person")}
            disabled={markPaidMut.isPending}
          >
            <CheckCircle2 className="h-4 w-4" /> Mark Paid
          </Button>
        )}
        {canVoid && (
          <Button
            variant="outline"
            onClick={() =>
              statusMut.mutate({ patch: { status: "void" }, allowedFrom: ["draft", "sent"] })
            }
          >
            <Ban className="h-4 w-4" /> Void
          </Button>
        )}
      </>
    );
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title={`Invoice ${inv.invoice_number ?? inv.id.slice(0, 8)}`}
          description={
            <div className="mt-2 flex items-center gap-2">
              <InvoiceStatusBadge status={eff} size="lg" />
              {inv.status === "paid" && inv.paid_at && (
                <span className="text-sm text-text-secondary">Paid on {formatDateTime(inv.paid_at, tz)}</span>
              )}
              {inv.status === "void" && <span className="text-sm text-text-secondary">Voided</span>}
            </div>
          }
          actions={renderActions()}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left: main invoice body */}
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="label-eyebrow mb-2">From</div>
                  <div className="text-sm font-medium text-foreground">{org?.name ?? "—"}</div>
                  {location && (
                    <div className="mt-1 text-sm text-text-secondary">
                      {location.street_address && <div>{location.street_address}</div>}
                      <div>
                        {[location.city, location.state_province, location.postal_code].filter(Boolean).join(", ")}
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <div className="label-eyebrow mb-2">To</div>
                  {owner ? (
                    <>
                      <div className="text-sm font-medium text-foreground">
                        {owner.first_name} {owner.last_name}
                      </div>
                      {owner.email && <div className="text-sm text-text-secondary">{owner.email}</div>}
                      {owner.phone && <div className="text-sm text-text-secondary">{owner.phone}</div>}
                    </>
                  ) : (
                    <div className="text-sm text-text-tertiary">—</div>
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-background text-left">
                    <th className="px-[18px] py-[12px] label-eyebrow">Description</th>
                    <th className="px-[18px] py-[12px] label-eyebrow text-right">Qty</th>
                    <th className="px-[18px] py-[12px] label-eyebrow text-right">Unit Price</th>
                    <th className="px-[18px] py-[12px] label-eyebrow text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l: any) => (
                    <tr key={l.id} className="border-t border-border-subtle">
                      <td className="px-[18px] py-[12px] text-foreground">{l.description}</td>
                      <td className="px-[18px] py-[12px] text-right text-text-secondary">{l.quantity}</td>
                      <td className="px-[18px] py-[12px] text-right text-text-secondary">
                        {formatCentsShort(l.unit_price_cents)}
                      </td>
                      <td className="px-[18px] py-[12px] text-right text-foreground">
                        {formatCentsShort(l.line_total_cents)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-border-subtle bg-card-alt/40">
                    <td colSpan={3} className="px-[18px] py-[10px] text-right text-text-secondary">
                      Subtotal
                    </td>
                    <td className="px-[18px] py-[10px] text-right text-foreground">
                      {formatCentsShort(inv.subtotal_cents)}
                    </td>
                  </tr>
                  <tr className="bg-card-alt/40">
                    <td colSpan={3} className="px-[18px] py-[10px] text-right text-text-secondary">
                      Tax
                    </td>
                    <td className="px-[18px] py-[10px] text-right text-foreground">
                      {formatCentsShort(inv.tax_cents ?? 0)}
                    </td>
                  </tr>
                  <tr className="border-t border-border bg-card-alt/60">
                    <td colSpan={3} className="px-[18px] py-[14px] text-right font-display text-base font-semibold">
                      Total
                    </td>
                    <td className="px-[18px] py-[14px] text-right font-display text-base font-semibold text-foreground">
                      {formatCentsShort(inv.total_cents)} {inv.currency}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Notes */}
            <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
              <div className="label-eyebrow mb-2">Notes</div>
              <Textarea
                rows={4}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesDirty(true);
                }}
                placeholder="Add a note for this invoice…"
                disabled={!canEditPerm}
              />
              {notesDirty && canEditPerm && (
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setNotes(inv.notes ?? "");
                      setNotesDirty(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveNotes}>
                    Save notes
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Right: meta */}
          <div className="space-y-6">
            <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-text-tertiary">Invoice date</dt>
                  <dd className="text-foreground">{formatDateTime(inv.issued_at, tz)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-tertiary">Due date</dt>
                  <dd className="text-foreground">{formatDateTime(inv.due_at, tz)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-tertiary">Payment terms</dt>
                  <dd className="text-foreground">Net 14</dd>
                </div>
                {reservation && (
                  <div>
                    <dt className="text-xs text-text-tertiary">Reservation</dt>
                    <dd>
                      <Link
                        to={`/reservations/${reservation.id}`}
                        className="text-foreground hover:text-primary"
                      >
                        {reservation.services?.name ?? "View reservation"} · {formatDateTime(reservation.start_at, tz)}
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {payments && payments.length > 0 && (
              <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
                <div className="label-eyebrow mb-3">Payments</div>
                <ul className="space-y-3 text-sm">
                  {payments.map((p) => {
                    const fundingLabel =
                      p.method === "card"
                        ? p.card_funding === "credit"
                          ? "Credit card"
                          : p.card_funding === "debit"
                            ? "Debit card"
                            : p.card_funding === "prepaid"
                              ? "Prepaid card"
                              : "Card"
                        : p.method === "ach"
                          ? "ACH transfer"
                          : p.method === "in_person"
                            ? "In person"
                            : p.method;
                    const when = p.processed_at ?? p.created_at;
                    const refundable =
                      p.status === "succeeded" &&
                      !!p.stripe_payment_intent_id &&
                      canRefundPerm;
                    const isRefunded = p.status === "refunded" || p.status === "partially_refunded";
                    return (
                      <li key={p.id} className="border-b border-border-subtle pb-3 last:border-b-0 last:pb-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium text-foreground">
                            {formatCentsShort(p.amount_cents)} {p.currency}
                          </span>
                          <span className="text-xs text-text-tertiary">
                            {when ? formatDateTime(when, tz) : ""}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-text-secondary">
                          <span>
                            {fundingLabel}
                            {isRefunded && (
                              <span className="ml-2 inline-flex items-center rounded-pill border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-text-tertiary">
                                {p.status === "partially_refunded" ? "partial refund" : "refunded"}
                              </span>
                            )}
                          </span>
                          {refundable && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() =>
                                setRefundFor({
                                  id: p.id,
                                  amount_cents: p.amount_cents,
                                  currency: p.currency,
                                })
                              }
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Refund
                            </Button>
                          )}
                        </div>
                        {p.expected_payout_at && (
                          <div className="mt-1 text-xs text-text-tertiary">
                            Expected to settle in your bank on{" "}
                            <span className="text-foreground">
                              {formatDateTime(p.expected_payout_at, tz)}
                            </span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {pets.length > 0 && (
              <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
                <div className="label-eyebrow mb-3">Pets</div>
                <ul className="space-y-2 text-sm">
                  {pets.map((p) => (
                    <li key={p.id}>
                      <Link to={`/pets/${p.id}`} className="text-foreground hover:text-primary">
                        {p.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <RefundPaymentDialog
        payment={refundFor}
        onOpenChange={(o) => !o && setRefundFor(null)}
        onRefunded={() => {
          // Refresh the payments list and the invoice (status may flip
          // when the underlying balance changes).
          qc.invalidateQueries({ queryKey: ["invoice-payments", id] });
          qc.invalidateQueries({ queryKey: ["invoice", id] });
        }}
      />
    </PortalLayout>
  );
}

// Confirm-and-submit dialog for a Stripe refund. Defaults to a full
// refund; the operator can edit the amount for a partial refund. Calls
// stripe-refund-payment, which handles the org's connected account,
// flips the payments row, and writes an activity_log row.
function RefundPaymentDialog({
  payment,
  onOpenChange,
  onRefunded,
}: {
  payment: { id: string; amount_cents: number; currency: string } | null;
  onOpenChange: (open: boolean) => void;
  onRefunded: () => void;
}) {
  const open = !!payment;
  const [reason, setReason] = useState<string>("requested_by_customer");
  const [amountStr, setAmountStr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset the form whenever a different payment is selected.
  useEffect(() => {
    if (payment) {
      setAmountStr((payment.amount_cents / 100).toFixed(2));
      setReason("requested_by_customer");
    }
  }, [payment?.id]);

  const submit = async () => {
    if (!payment) return;
    const cents = Math.round(parseFloat(amountStr || "0") * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error("Invalid refund amount");
      return;
    }
    if (cents > payment.amount_cents) {
      toast.error("Refund amount exceeds the original payment");
      return;
    }
    setSubmitting(true);
    try {
      const isFull = cents === payment.amount_cents;
      const { data, error } = await supabase.functions.invoke(
        "stripe-refund-payment",
        {
          body: {
            payment_id: payment.id,
            reason: reason || null,
            // Stripe refunds the full amount when amount_cents is omitted;
            // pass it only for partial.
            ...(isFull ? {} : { amount_cents: cents }),
          },
        },
      );
      if (error) {
        toast.error(error.message ?? String(error));
        return;
      }
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) {
        toast.error(result?.error ?? "Could not refund payment");
        return;
      }
      toast.success(isFull ? "Refund issued" : "Partial refund issued");
      onRefunded();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!payment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund payment</DialogTitle>
          <DialogDescription>
            This issues a refund through Stripe and updates the invoice.
            Your QuickBooks integration (if connected) syncs the
            RefundReceipt automatically on its next tick.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Amount ({payment.currency})</Label>
            <Input
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-text-tertiary">
              Original payment was{" "}
              {(payment.amount_cents / 100).toFixed(2)} {payment.currency}.
              Edit for a partial refund.
            </p>
          </div>
          <div>
            <Label className="text-xs">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="requested_by_customer">Requested by customer</SelectItem>
                <SelectItem value="duplicate">Duplicate charge</SelectItem>
                <SelectItem value="fraudulent">Fraudulent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} className="gap-2">
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitting ? "Refunding…" : "Issue refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
