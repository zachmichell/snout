import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Power, Tag } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/format";
import { centsToDollarString, parseDollarsToCents, formatCentsShort } from "@/lib/money";

type Promo = {
  id: string; code: string; description: string | null;
  discount_type: "percent" | "fixed"; discount_value: number;
  valid_from: string | null; valid_to: string | null;
  usage_count: number; max_uses: number | null; active: boolean;
};

function emptyForm() {
  return {
    code: "", description: "",
    discount_type: "percent" as "percent" | "fixed",
    discount_input: "", // %, or $ amount
    valid_from: "", valid_to: "",
    max_uses: "", active: true,
  };
}

function formatDiscount(p: Promo) {
  if (p.discount_type === "percent") return `${(p.discount_value / 100).toFixed(p.discount_value % 100 === 0 ? 0 : 2)}%`;
  return formatCentsShort(p.discount_value);
}

export function PosPromotionsSection({ showHeader = true }: { showHeader?: boolean } = {}) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Promo | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: promos = [], isLoading } = useQuery({
    queryKey: ["promotions", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("promotions").select("*")
        .eq("organization_id", orgId!).is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Promo[];
    },
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setOpen(true); };
  const openEdit = (p: Promo) => {
    setEditing(p);
    setForm({
      code: p.code, description: p.description ?? "",
      discount_type: p.discount_type,
      discount_input: p.discount_type === "percent"
        ? String(p.discount_value / 100)
        : centsToDollarString(p.discount_value),
      valid_from: p.valid_from ? p.valid_from.slice(0, 10) : "",
      valid_to: p.valid_to ? p.valid_to.slice(0, 10) : "",
      max_uses: p.max_uses != null ? String(p.max_uses) : "",
      active: p.active,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim()) throw new Error("Code required");
      let discount_value: number;
      if (form.discount_type === "percent") {
        const pct = Number(form.discount_input);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("Percent must be 0–100");
        discount_value = Math.round(pct * 100);
      } else {
        const cents = parseDollarsToCents(form.discount_input);
        if (cents == null) throw new Error("Invalid amount");
        discount_value = cents;
      }
      const payload = {
        code: form.code.trim().toUpperCase(),
        description: form.description.trim() || null,
        discount_type: form.discount_type,
        discount_value,
        valid_from: form.valid_from ? new Date(form.valid_from).toISOString() : null,
        valid_to: form.valid_to ? new Date(form.valid_to).toISOString() : null,
        max_uses: form.max_uses ? parseInt(form.max_uses) : null,
        active: form.active,
        organization_id: orgId!,
      };
      if (editing) {
        const { error } = await supabase.from("promotions").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("promotions").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Promotion updated" : "Promotion created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["promotions", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Promo) => {
      const { error } = await supabase.from("promotions").update({ active: !p.active }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promotions", orgId] }),
  });

  return (
    <>
      {showHeader && (
        <PageHeader title="Promotions" description="Discount codes for the POS"
          actions={<Button onClick={openCreate}><Plus className="h-4 w-4" /> New Code</Button>}
        />
      )}
        <div className="rounded-lg border border-border bg-surface shadow-card">
          {isLoading ? (
            <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
          ) : promos.length === 0 ? (
            <div className="p-6"><EmptyState icon={Tag} title="No promotions" description="Create discount codes to apply at checkout." /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background text-left">
                  <th className="px-[18px] py-[14px] label-eyebrow">Code</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Description</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Discount</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Valid</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Uses</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Status</th>
                  <th className="px-[18px] py-[14px] text-right"></th>
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <tr key={p.id} className="border-t border-border-subtle hover:bg-background">
                    <td className="px-[18px] py-[14px] font-mono font-medium text-foreground">{p.code}</td>
                    <td className="px-[18px] py-[14px] text-text-secondary">{p.description ?? "—"}</td>
                    <td className="px-[18px] py-[14px] text-foreground">{formatDiscount(p)}</td>
                    <td className="px-[18px] py-[14px] text-text-secondary">
                      {p.valid_from ? formatDate(p.valid_from) : "—"} → {p.valid_to ? formatDate(p.valid_to) : "—"}
                    </td>
                    <td className="px-[18px] py-[14px] text-text-secondary">
                      {p.usage_count}{p.max_uses ? ` / ${p.max_uses}` : ""}
                    </td>
                    <td className="px-[18px] py-[14px]">
                      <Badge variant="outline" className={p.active ? "border-success text-success" : "text-text-tertiary"}>
                        {p.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-[18px] py-[14px] text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate(p)}><Power className="h-3.5 w-3.5" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">{editing ? "Edit Promotion" : "New Promotion"}</DialogTitle>
            <DialogDescription>Codes are case-insensitive; stored uppercase.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5"><Label className="text-xs">Code *</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SUMMER20" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Type</Label>
                <Select value={form.discount_type} onValueChange={(v) => setForm({ ...form, discount_type: v as "percent" | "fixed" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent (%)</SelectItem>
                    <SelectItem value="fixed">Fixed amount ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Value *</Label>
                <Input inputMode="decimal" value={form.discount_input}
                  onChange={(e) => setForm({ ...form, discount_input: e.target.value })}
                  placeholder={form.discount_type === "percent" ? "20" : "10.00"} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Valid From</Label>
                <Input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Valid To</Label>
                <Input type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Max Uses</Label>
              <Input inputMode="numeric" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} placeholder="unlimited" /></div>
            <div className="flex items-center gap-3">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label className="text-sm">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function PosPromotions() {
  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PosPromotionsSection />
      </div>
    </PortalLayout>
  );
}
