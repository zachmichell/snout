import { useEffect } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, AlertTriangle, Clock, CreditCard } from "lucide-react";
import { toast } from "sonner";
import InvoiceStatusBadge from "@/components/portal/InvoiceStatusBadge";
import { Button } from "@/components/ui/button";
import { useOwnerInvoice } from "@/hooks/useOwnerInvoices";
import { useCreateCheckoutSession } from "@/hooks/useStripeConnect";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { effectiveInvoiceStatus } from "@/lib/invoice";

export default function OwnerInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { data: invoice, isLoading, error } = useOwnerInvoice(id);
  const checkout = useCreateCheckoutSession();

  // Handle return from Stripe Checkout
  useEffect(() => {
    const payment = params.get("payment");
    if (payment === "success") {
      toast.success("Payment received. Thank you!");
      qc.invalidateQueries({ queryKey: ["owner-invoice", id] });
      qc.invalidateQueries({ queryKey: ["owner-invoices-list"] });
    } else if (payment === "cancelled") {
      toast.message("Payment cancelled. Your invoice is still pending.");
    }
    if (payment) {
      const next = new URLSearchParams(params);
      next.delete("payment");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("payment")]);

  if (isLoading) {
    return <div className="text-center text-sm text-muted-foreground">Loading invoice…</div>;
  }
  if (error || !invoice) {
    return <Navigate to="/portal/invoices" replace />;
  }

  const eff = effectiveInvoiceStatus(invoice.status, invoice.due_at);
  const balance = (invoice.total_cents ?? 0) - (invoice.amount_paid_cents ?? 0);
  const org: any = (invoice as any).organizations;
  const owner: any = (invoice as any).owners;
  const reservation: any = (invoice as any).reservations;
  const location: any = reservation?.locations;
  const lines: any[] = (invoice as any).invoice_lines ?? [];
  const taxes: any[] = (invoice as any).invoice_taxes ?? [];
  const orgName = org?.name ?? "the business";
  const currency = invoice.currency;
  const canPay =
    balance > 0 && (invoice.status === "sent" || invoice.status === "partial");

  const handlePay = async () => {
    if (!id) return;
    try {
      const res = await checkout.mutateAsync(id);
      window.location.href = res.checkout_url;
    } catch (e: any) {
      const msg = e?.message ?? "Could not start payment";
      if (msg.toLowerCase().includes("already paid")) {
        toast.message("This invoice has already been paid.");
        qc.invalidateQueries({ queryKey: ["owner-invoice", id] });
      } else if (msg.toLowerCase().includes("not set up")) {
        toast.error(`${orgName} hasn't enabled online payments yet.`);
      } else {
        toast.error(msg);
      }
    }
  };

  return (
    <div>
      <Link
        to="/portal/invoices"
        className="mb-6 inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to invoices
      </Link>

      {/* Status banner */}
      {eff === "paid" && (
        <Banner tone="success" icon={CheckCircle2} title="Paid in full" />
      )}
      {eff === "overdue" && (
        <Banner
          tone="danger"
          icon={AlertTriangle}
          title="Payment overdue"
          body={`Please contact ${orgName} to arrange payment.`}
        />
      )}
      {eff === "sent" && (
        <Banner
          tone="info"
          icon={Clock}
          title={`Payment is due by ${formatDate(invoice.due_at)}`}
          body={`Contact ${orgName} for payment options.`}
        />
      )}

      {/* Invoice document */}
      <article className="mt-6 rounded-2xl border border-border bg-card p-8 shadow-sm sm:p-10">
        {/* Header */}
        <header className="flex flex-col gap-6 border-b border-border-subtle pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">{org?.name}</h1>
            {location && (
              <address className="mt-2 text-sm not-italic text-muted-foreground">
                {location.street_address}
                {location.street_address && <br />}
                {[location.city, location.state_province].filter(Boolean).join(", ")}{" "}
                {location.postal_code}
                {location.phone && (
                  <>
                    <br />
                    {location.phone}
                  </>
                )}
                {location.email && (
                  <>
                    <br />
                    {location.email}
                  </>
                )}
              </address>
            )}
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Invoice
            </p>
            <p className="font-display text-xl font-bold text-foreground">
              {invoice.invoice_number ?? invoice.id.slice(0, 8)}
            </p>
            <div className="mt-2">
              <InvoiceStatusBadge status={eff} size="lg" />
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-6 sm:justify-end sm:gap-3">
                <dt className="text-muted-foreground">Issued:</dt>
                <dd className="font-medium text-foreground">{formatDate(invoice.issued_at)}</dd>
              </div>
              <div className="flex justify-between gap-6 sm:justify-end sm:gap-3">
                <dt className="text-muted-foreground">Due:</dt>
                <dd
                  className={`font-medium ${eff === "overdue" ? "text-destructive" : "text-foreground"}`}
                >
                  {formatDate(invoice.due_at)}
                </dd>
              </div>
            </dl>
          </div>
        </header>

        {/* Bill to */}
        {owner && (
          <section className="border-b border-border-subtle py-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Bill to
            </p>
            <p className="mt-2 font-medium text-foreground">
              {owner.first_name} {owner.last_name}
            </p>
            <address className="mt-1 text-sm not-italic text-muted-foreground">
              {owner.street_address && (
                <>
                  {owner.street_address}
                  <br />
                </>
              )}
              {[owner.city, owner.state_province].filter(Boolean).join(", ")} {owner.postal_code}
              {owner.email && (
                <>
                  <br />
                  {owner.email}
                </>
              )}
              {owner.phone && (
                <>
                  <br />
                  {owner.phone}
                </>
              )}
            </address>
          </section>
        )}

        {/* Reservation reference */}
        {reservation?.services?.name && (
          <section className="border-b border-border-subtle py-4">
            <p className="text-sm text-muted-foreground">
              For:{" "}
              <span className="font-medium text-foreground">{reservation.services.name}</span>
              {reservation.start_at && ` · ${formatDate(reservation.start_at)}`}
            </p>
          </section>
        )}

        {/* Line items */}
        <section className="py-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left">
                  <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Description
                  </th>
                  <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Qty
                  </th>
                  <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Unit Price
                  </th>
                  <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      No line items
                    </td>
                  </tr>
                ) : (
                  lines.map((l) => (
                    <tr key={l.id} className="border-b border-border-subtle/60">
                      <td className="py-3 text-foreground">{l.description}</td>
                      <td className="py-3 text-right text-foreground">{l.quantity}</td>
                      <td className="py-3 text-right text-foreground">
                        {formatCents(l.unit_price_cents, currency)}
                      </td>
                      <td className="py-3 text-right font-medium text-foreground">
                        {formatCents(l.line_total_cents, currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Totals */}
        <section className="ml-auto max-w-sm space-y-2 border-t border-border-subtle pt-6 text-sm">
          <Row label="Subtotal" value={formatCents(invoice.subtotal_cents, currency)} />
          {taxes.map((t) => (
            <Row
              key={t.id}
              label={`${t.name} (${(t.rate_basis_points / 100).toFixed(2)}%)`}
              value={formatCents(t.amount_cents, currency)}
            />
          ))}
          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <span className="font-display text-lg font-bold text-foreground">Total</span>
            <span className="font-display text-xl font-bold text-foreground">
              {formatCents(invoice.total_cents, currency)}
            </span>
          </div>
          {(invoice.amount_paid_cents ?? 0) > 0 && (
            <Row
              label="Amount paid"
              value={`− ${formatCents(invoice.amount_paid_cents, currency)}`}
            />
          )}
          {balance !== invoice.total_cents && (
            <div
              className={`flex items-baseline justify-between rounded-lg px-3 py-2 ${
                balance > 0 ? "bg-destructive-light" : "bg-mist-bg"
              }`}
            >
              <span className="font-semibold text-foreground">Balance due</span>
              <span
                className={`font-display text-lg font-bold ${balance > 0 ? "text-destructive" : "text-success"}`}
              >
                {formatCents(balance, currency)}
              </span>
            </div>
          )}
          {canPay && (
            <Button
              onClick={handlePay}
              disabled={checkout.isPending}
              className="mt-4 w-full bg-accent text-white hover:bg-accent-hover"
              size="lg"
            >
              <CreditCard className="h-4 w-4" />
              {checkout.isPending
                ? "Redirecting to Stripe…"
                : `Pay ${formatCents(balance, currency)} now`}
            </Button>
          )}
        </section>

        {invoice.notes && (
          <section className="mt-6 border-t border-border-subtle pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notes
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{invoice.notes}</p>
          </section>
        )}
      </article>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function Banner({
  tone,
  icon: Icon,
  title,
  body,
}: {
  tone: "success" | "danger" | "info";
  icon: any;
  title: string;
  body?: string;
}) {
  const cls =
    tone === "success"
      ? "border-mist/40 bg-mist-bg text-success"
      : tone === "danger"
        ? "border-destructive/30 bg-destructive-light text-destructive"
        : "border-frost/40 bg-frost-bg text-foreground";
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5" />
        <div>
          <p className="font-semibold">{title}</p>
          {body && <p className="mt-0.5 text-sm opacity-90">{body}</p>}
        </div>
      </div>
    </div>
  );
}
