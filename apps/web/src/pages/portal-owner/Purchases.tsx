import { Link } from "react-router-dom";
import { CreditCard, ChevronRight } from "lucide-react";
import { useOwnerPayments } from "@/hooks/useOwnerPayments";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

const methodLabel: Record<string, string> = {
  card: "Card",
  ach: "ACH",
  in_person: "In-Person",
};

const statusVariant: Record<string, { label: string; cls: string }> = {
  succeeded: { label: "Paid", cls: "bg-success-light text-success border-success/30" },
  pending: { label: "Pending", cls: "bg-warning-light text-warning border-warning/30" },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive border-destructive/30" },
  refunded: { label: "Refunded", cls: "bg-muted text-muted-foreground border-border" },
};

export default function Purchases() {
  const { data: payments = [], isLoading } = useOwnerPayments();

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">My Purchases</h1>
        <p className="mt-2 text-base text-muted-foreground">
          A record of every payment on your account
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : payments.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
          <CreditCard className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-base text-foreground">No purchases yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Payments toward your invoices will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-3 sm:hidden">
            {payments.map((p) => {
              const desc = p.invoices?.reservations?.services?.name
                ?? (p.invoices?.invoice_number ? `Invoice ${p.invoices.invoice_number}` : "Payment");
              const status = statusVariant[p.status] ?? statusVariant.pending;
              return (
                <li key={p.id}>
                  <Link
                    to={p.invoice_id ? `/portal/invoices/${p.invoice_id}` : "#"}
                    className="block rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{desc}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDate(p.processed_at ?? p.created_at)} · {methodLabel[p.method] ?? p.method}
                        </p>
                      </div>
                      <p className="font-display text-lg font-semibold text-foreground whitespace-nowrap">
                        {formatCents(p.amount_cents, p.currency)}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <Badge variant="outline" className={status.cls}>
                        {status.label}
                      </Badge>
                      {p.invoice_id && (
                        <span className="inline-flex items-center text-xs text-primary">
                          View invoice <ChevronRight className="ml-0.5 h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-card-alt">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3">Method</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const desc = p.invoices?.reservations?.services?.name
                    ?? (p.invoices?.invoice_number ? `Invoice ${p.invoices.invoice_number}` : "Payment");
                  const status = statusVariant[p.status] ?? statusVariant.pending;
                  return (
                    <tr key={p.id} className="border-t border-border-subtle hover:bg-card-alt/60">
                      <td className="px-5 py-4 text-foreground">
                        {formatDate(p.processed_at ?? p.created_at)}
                      </td>
                      <td className="px-5 py-4 text-foreground">
                        <div className="font-medium">{desc}</div>
                        {p.invoices?.invoice_number && (
                          <div className="text-xs text-muted-foreground">
                            Invoice {p.invoices.invoice_number}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {methodLabel[p.method] ?? p.method}
                      </td>
                      <td className="px-5 py-4">
                        <Badge variant="outline" className={status.cls}>
                          {status.label}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-right font-display text-base font-semibold text-foreground">
                        {formatCents(p.amount_cents, p.currency)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {p.invoice_id && (
                          <Link
                            to={`/portal/invoices/${p.invoice_id}`}
                            className="inline-flex items-center text-sm font-medium text-primary hover:text-primary-hover"
                          >
                            View <ChevronRight className="h-4 w-4" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
