import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, RefreshCcw, XCircle } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";
import { depositStatusLabel } from "@/lib/deposits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function money(cents: number) {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  paid: "default",
  refunded: "outline",
  forfeited: "destructive",
};

export default function Deposits() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";

  const [status, setStatus] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const { data: deposits = [], isLoading } = useQuery({
    queryKey: ["deposits-list", orgId, status, from, to],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from("deposits")
        .select(
          `id, amount_cents, status, paid_at, created_at,
           owner:owner_id(id, first_name, last_name),
           pet:pet_id(id, name),
           reservation:reservation_id(id, start_at),
           service:service_id(id, name)`,
        )
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      if (status !== "all") q = q.eq("status", status);
      if (from) q = q.gte("created_at", new Date(from).toISOString());
      if (to) q = q.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: "paid" | "refunded" | "forfeited" }) => {
      const patch: {
        status: string;
        paid_at?: string;
        refunded_at?: string;
        forfeited_at?: string;
      } = { status: newStatus };
      if (newStatus === "paid") patch.paid_at = new Date().toISOString();
      if (newStatus === "refunded") patch.refunded_at = new Date().toISOString();
      if (newStatus === "forfeited") patch.forfeited_at = new Date().toISOString();
      const { error } = await supabase.from("deposits").update(patch).eq("id", id);
      if (error) throw error;
      await logActivity({
        organization_id: orgId,
        action: newStatus,
        entity_type: "deposit",
        entity_id: id,
      });
    },
    onSuccess: () => {
      toast.success("Deposit updated");
      qc.invalidateQueries({ queryKey: ["deposits-list"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader title="Deposits" description="Track upfront payments collected for reservations." />

        <div className="flex flex-wrap gap-3 mb-4 items-end">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
                <SelectItem value="forfeited">Forfeited</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
          </div>
          {(from || to || status !== "all") && (
            <Button variant="ghost" onClick={() => { setStatus("all"); setFrom(""); setTo(""); }}>Clear</Button>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Owner</TableHead>
                <TableHead>Pet</TableHead>
                <TableHead>Reservation Date</TableHead>
                <TableHead>Service</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead className="w-[280px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : deposits.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No deposits yet.</TableCell></TableRow>
              ) : (
                deposits.map((d: any) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      {d.owner ? `${d.owner.first_name} ${d.owner.last_name}` : "—"}
                    </TableCell>
                    <TableCell>{d.pet?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {d.reservation?.start_at ? new Date(d.reservation.start_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>{d.service?.name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{money(d.amount_cents)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[d.status] ?? "default"}>{depositStatusLabel(d.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {d.paid_at ? new Date(d.paid_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {d.status === "pending" && (
                        <Button variant="ghost" size="sm" onClick={() => updateStatus.mutate({ id: d.id, newStatus: "paid" })}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Paid
                        </Button>
                      )}
                      {d.status === "paid" && (
                        <Button variant="ghost" size="sm" onClick={() => updateStatus.mutate({ id: d.id, newStatus: "refunded" })}>
                          <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Refund
                        </Button>
                      )}
                      {(d.status === "pending" || d.status === "paid") && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => updateStatus.mutate({ id: d.id, newStatus: "forfeited" })}>
                          <XCircle className="h-3.5 w-3.5 mr-1" /> Forfeit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </PortalLayout>
  );
}
