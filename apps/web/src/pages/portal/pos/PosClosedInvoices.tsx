import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FileCheck } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatCentsShort } from "@/lib/money";
import { formatDate } from "@/lib/format";
import InvoiceStatusBadge from "@/components/portal/InvoiceStatusBadge";

export function PosClosedInvoicesSection({ showHeader = true }: { showHeader?: boolean } = {}) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["pos-closed-invoices", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, owner_id, total_cents, paid_at, status")
        .eq("organization_id", orgId!)
        .in("status", ["paid"])
        .is("deleted_at", null)
        .order("paid_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const ownerIds = Array.from(new Set((data ?? []).map((i) => i.owner_id)));
      const [{ data: owners }, { data: payments }] = await Promise.all([
        ownerIds.length
          ? supabase.from("owners").select("id, first_name, last_name").in("id", ownerIds)
          : Promise.resolve({ data: [] as any[] }),
        (data ?? []).length
          ? supabase.from("payments").select("invoice_id, method").in("invoice_id", (data ?? []).map((i) => i.id))
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const oMap = new Map((owners ?? []).map((o: any) => [o.id, o]));
      const pMap = new Map((payments ?? []).map((p: any) => [p.invoice_id, p]));
      return (data ?? []).map((i: any) => ({ ...i, owner: oMap.get(i.owner_id), payment: pMap.get(i.id) }));
    },
  });

  return (
    <>
      {showHeader && <PageHeader title="Closed Invoices" description="Paid invoices from POS sales" />}
      <div className="rounded-lg border border-border bg-surface shadow-card">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
        ) : invoices.length === 0 ? (
          <div className="p-6"><EmptyState icon={FileCheck} title="No closed invoices" description="Paid invoices will appear here." /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background text-left">
                <th className="px-[18px] py-[14px] label-eyebrow">Invoice #</th>
                <th className="px-[18px] py-[14px] label-eyebrow">Owner</th>
                <th className="px-[18px] py-[14px] label-eyebrow">Date</th>
                <th className="px-[18px] py-[14px] label-eyebrow">Total</th>
                <th className="px-[18px] py-[14px] label-eyebrow">Method</th>
                <th className="px-[18px] py-[14px] label-eyebrow">Status</th>
                <th className="px-[18px] py-[14px] text-right"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i: any) => (
                <tr key={i.id} className="border-t border-border-subtle hover:bg-background">
                  <td className="px-[18px] py-[14px] font-mono text-foreground">{i.invoice_number ?? "—"}</td>
                  <td className="px-[18px] py-[14px] text-foreground">
                    {i.owner ? `${i.owner.first_name} ${i.owner.last_name}` : "—"}
                  </td>
                  <td className="px-[18px] py-[14px] text-text-secondary">{i.paid_at ? formatDate(i.paid_at) : "—"}</td>
                  <td className="px-[18px] py-[14px] text-foreground">{formatCentsShort(i.total_cents)}</td>
                  <td className="px-[18px] py-[14px] text-text-secondary capitalize">{i.payment?.method ?? "—"}</td>
                  <td className="px-[18px] py-[14px]"><InvoiceStatusBadge status={i.status} /></td>
                  <td className="px-[18px] py-[14px] text-right">
                    <Button asChild variant="ghost" size="sm"><Link to={`/invoices/${i.id}`}>View</Link></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default function PosClosedInvoices() {
  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PosClosedInvoicesSection />
      </div>
    </PortalLayout>
  );
}
