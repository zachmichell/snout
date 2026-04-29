import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FileClock, ShoppingCart } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatCentsShort } from "@/lib/money";
import { formatDate } from "@/lib/format";

export function PosOpenInvoicesSection({ showHeader = true }: { showHeader?: boolean } = {}) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: carts = [], isLoading } = useQuery({
    queryKey: ["pos-open-carts", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_carts")
        .select("id, owner_id, total_cents, subtotal_cents, created_at, notes")
        .eq("organization_id", orgId!)
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ownerIds = Array.from(new Set((data ?? []).map((c) => c.owner_id)));
      const { data: owners } = ownerIds.length
        ? await supabase.from("owners").select("id, first_name, last_name").in("id", ownerIds)
        : { data: [] as any[] };
      const map = new Map((owners ?? []).map((o: any) => [o.id, o]));
      return (data ?? []).map((c: any) => ({ ...c, owner: map.get(c.owner_id) }));
    },
  });

  const voidCart = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pos_carts")
        .update({ status: "voided", voided_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cart voided");
      qc.invalidateQueries({ queryKey: ["pos-open-carts", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
      {showHeader && (
        <PageHeader
          title="Open Invoices"
          description="Saved carts that haven't been charged yet"
          actions={<Button onClick={() => navigate("/pos/cart")}><ShoppingCart className="h-4 w-4" /> New Sale</Button>}
        />
      )}
      <div className="rounded-lg border border-border bg-surface shadow-card">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
        ) : carts.length === 0 ? (
          <div className="p-6"><EmptyState icon={FileClock} title="No open invoices" description="Saved carts will appear here." /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background text-left">
                <th className="px-[18px] py-[14px] label-eyebrow">Owner</th>
                <th className="px-[18px] py-[14px] label-eyebrow">Date</th>
                <th className="px-[18px] py-[14px] label-eyebrow">Notes</th>
                <th className="px-[18px] py-[14px] label-eyebrow">Total</th>
                <th className="px-[18px] py-[14px] label-eyebrow">Status</th>
                <th className="px-[18px] py-[14px] text-right"></th>
              </tr>
            </thead>
            <tbody>
              {carts.map((c: any) => (
                <tr key={c.id} className="border-t border-border-subtle hover:bg-background">
                  <td className="px-[18px] py-[14px] font-medium text-foreground">
                    {c.owner ? `${c.owner.first_name} ${c.owner.last_name}` : "—"}
                  </td>
                  <td className="px-[18px] py-[14px] text-text-secondary">{formatDate(c.created_at)}</td>
                  <td className="px-[18px] py-[14px] text-text-secondary">{c.notes ?? "—"}</td>
                  <td className="px-[18px] py-[14px] text-foreground">{formatCentsShort(c.total_cents)}</td>
                  <td className="px-[18px] py-[14px]">
                    <Badge variant="outline" className="border-warning text-warning">Open</Badge>
                  </td>
                  <td className="px-[18px] py-[14px] text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/pos/cart?cart=${c.id}`}>Resume & Pay</Link>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => voidCart.mutate(c.id)}>Void</Button>
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

export default function PosOpenInvoices() {
  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PosOpenInvoicesSection />
      </div>
    </PortalLayout>
  );
}
