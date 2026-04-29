import { Link } from "react-router-dom";
import { Receipt, ChevronRight } from "lucide-react";
import InvoiceStatusBadge from "@/components/portal/InvoiceStatusBadge";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { effectiveInvoiceStatus, isOverdueDisplay } from "@/lib/invoice";

export default function InvoiceCard({ invoice }: { invoice: any }) {
  const eff = effectiveInvoiceStatus(invoice.status, invoice.due_at);
  const overdue = isOverdueDisplay(invoice.status, invoice.due_at);
  const balance = (invoice.total_cents ?? 0) - (invoice.amount_paid_cents ?? 0);
  const reservation = invoice.reservations;

  return (
    <Link
      to={`/portal/invoices/${invoice.id}`}
      className="group block rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg font-semibold text-foreground">
              {invoice.invoice_number ?? `Invoice ${invoice.id.slice(0, 8)}`}
            </h3>
            <InvoiceStatusBadge status={eff} />
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <div className="flex justify-between sm:block">
              <dt className="text-muted-foreground">Issued</dt>
              <dd className="font-medium text-foreground sm:mt-0.5">
                {formatDate(invoice.issued_at)}
              </dd>
            </div>
            <div className="flex justify-between sm:block">
              <dt className="text-muted-foreground">Due</dt>
              <dd
                className={`font-medium sm:mt-0.5 ${overdue ? "text-destructive" : "text-foreground"}`}
              >
                {formatDate(invoice.due_at)}
              </dd>
            </div>
          </dl>
          {reservation?.services?.name && (
            <p className="mt-3 text-sm text-muted-foreground">
              For: <span className="text-foreground">{reservation.services.name}</span>
              {reservation.start_at && ` · ${formatDate(reservation.start_at)}`}
            </p>
          )}
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="text-right">
            <p className="font-display text-2xl font-bold text-foreground">
              {formatCents(invoice.total_cents, invoice.currency)}
            </p>
            {balance > 0 && eff !== "paid" && (
              <p className="mt-0.5 text-sm font-medium text-destructive">
                Balance: {formatCents(balance, invoice.currency)}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="pointer-events-none group-hover:bg-primary group-hover:text-primary-foreground"
            asChild
          >
            <span>
              View details <ChevronRight className="ml-1 h-4 w-4" />
            </span>
          </Button>
        </div>
      </div>
    </Link>
  );
}
