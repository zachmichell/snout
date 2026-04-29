import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import InvoiceStatusBadge from "@/components/portal/InvoiceStatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { formatCentsShort, formatDateTime } from "@/lib/money";
import { effectiveInvoiceStatus } from "@/lib/invoice";
import { usePermissions } from "@/hooks/usePermissions";
import { useLocationFilter } from "@/contexts/LocationContext";
import { downloadCsv, toCsv } from "@/lib/csv";
import { Download } from "lucide-react";

const PAGE_SIZE = 10;

function firstOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}
function lastOfMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}
function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function InvoicesList() {
  const { can } = usePermissions();
  const canCreate = can("invoices.create");
  const locationId = useLocationFilter();
  const [status, setStatus] = useState<string>("all");
  const [from, setFrom] = useState<string>(ymd(firstOfMonth()));
  const [to, setTo] = useState<string>(ymd(lastOfMonth()));
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["invoices-list", status, from, to, locationId],
    queryFn: async () => {
      let q = supabase
        .from("invoices")
        .select(
          `id, invoice_number, status, issued_at, due_at, total_cents, currency,
           owners:owner_id(id, first_name, last_name)`,
        )
        .is("deleted_at", null)
        .order("issued_at", { ascending: false, nullsFirst: false });
      if (status !== "all") q = q.eq("status", status as any);
      if (from) q = q.gte("issued_at", new Date(from + "T00:00:00").toISOString());
      if (to) q = q.lte("issued_at", new Date(to + "T23:59:59").toISOString());
      if (locationId) q = q.eq("location_id", locationId);
      const { data, error } = await q.limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r: any) => {
      const num = (r.invoice_number ?? "").toLowerCase();
      const o = r.owners ? `${r.owners.first_name ?? ""} ${r.owners.last_name ?? ""}`.toLowerCase() : "";
      return num.includes(s) || o.includes(s);
    });
  }, [rows, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Invoices"
          description="Billing records — auto-generated when reservations check out."
          actions={
            <div className="flex gap-2">
              {can("data.export") && (
                <Button variant="outline" onClick={() => {
                  const exportRows = filtered.map((r: any) => ({
                    invoice_number: r.invoice_number ?? "",
                    status: r.status, issued_at: r.issued_at, due_at: r.due_at,
                    total_cents: r.total_cents, currency: r.currency,
                    owner: r.owners ? `${r.owners.first_name} ${r.owners.last_name}` : "",
                  }));
                  downloadCsv(`invoices-${from}-to-${to}.csv`, toCsv(exportRows));
                }}>
                  <Download className="h-4 w-4" /> Export CSV
                </Button>
              )}
              {canCreate && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button disabled className="opacity-60">
                        <Plus className="h-4 w-4" /> New Invoice
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Coming soon</TooltipContent>
                </Tooltip>
              )}
            </div>
          }
        />

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-card">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[140px] bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="void">Void</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary">From</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
              className="w-[160px] bg-background"
            />
            <span className="text-xs text-text-tertiary">To</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
              className="w-[160px] bg-background"
            />
          </div>
          <Input
            placeholder="Search invoice # or owner…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="w-[260px] bg-background"
          />
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border bg-surface shadow-card">
          {isLoading ? (
            <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <div className="font-display text-base text-foreground">No invoices yet</div>
              <p className="mt-1 text-sm text-text-secondary">
                Invoices are automatically created when you check out a reservation.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background text-left">
                  <th className="px-[18px] py-[12px] label-eyebrow">Invoice #</th>
                  <th className="px-[18px] py-[12px] label-eyebrow">Owner</th>
                  <th className="px-[18px] py-[12px] label-eyebrow">Issued</th>
                  <th className="px-[18px] py-[12px] label-eyebrow">Due</th>
                  <th className="px-[18px] py-[12px] label-eyebrow text-right">Amount</th>
                  <th className="px-[18px] py-[12px] label-eyebrow">Status</th>
                  <th className="px-[18px] py-[12px]" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r: any) => {
                  const eff = effectiveInvoiceStatus(r.status, r.due_at);
                  return (
                    <tr key={r.id} className="border-t border-border-subtle hover:bg-card-alt">
                      <td className="px-[18px] py-[14px] font-medium text-foreground">
                        {r.invoice_number ?? r.id.slice(0, 8)}
                      </td>
                      <td className="px-[18px] py-[14px]">
                        {r.owners ? (
                          <Link to={`/owners/${r.owners.id}`} className="text-foreground hover:text-primary">
                            {r.owners.first_name} {r.owners.last_name}
                          </Link>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-[18px] py-[14px] text-text-secondary">{formatDateTime(r.issued_at)}</td>
                      <td className="px-[18px] py-[14px] text-text-secondary">{formatDateTime(r.due_at)}</td>
                      <td className="px-[18px] py-[14px] text-right font-medium text-foreground">
                        {formatCentsShort(r.total_cents)}
                      </td>
                      <td className="px-[18px] py-[14px]">
                        <InvoiceStatusBadge status={eff} />
                      </td>
                      <td className="px-[18px] py-[14px] text-right">
                        <Link to={`/invoices/${r.id}`}>
                          <Button variant="outline" size="sm">
                            View
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <span className="text-xs text-text-secondary">
              Page {page + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
