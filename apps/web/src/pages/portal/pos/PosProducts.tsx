import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Power, Boxes, AlertTriangle } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
// PosProductsSection is body-only (no PortalLayout) for embedding in tabs.
import EmptyState from "@/components/portal/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { centsToDollarString, parseDollarsToCents, formatCentsShort } from "@/lib/money";

const CATEGORIES = [
  { v: "food", l: "Food" },
  { v: "treats", l: "Treats" },
  { v: "toys", l: "Toys" },
  { v: "accessories", l: "Accessories" },
  { v: "grooming_supplies", l: "Grooming Supplies" },
  { v: "health", l: "Health" },
  { v: "other", l: "Other" },
];

type Product = {
  id: string; name: string; sku: string | null; category: string;
  description: string | null; price_cents: number; cost_cents: number;
  stock_quantity: number; reorder_point: number;
  manufacturer: string | null; vendor: string | null; active: boolean;
};

function emptyForm() {
  return {
    name: "", sku: "", category: "other", description: "",
    price_dollars: "0.00", cost_dollars: "0.00",
    stock_quantity: "0", reorder_point: "0",
    manufacturer: "", vendor: "", active: true,
  };
}

export function PosProductsSection({ showHeader = true }: { showHeader?: boolean } = {}) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["retail-products", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("retail_products").select("*")
        .eq("organization_id", orgId!).is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setOpen(true); };
  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name, sku: p.sku ?? "", category: p.category,
      description: p.description ?? "",
      price_dollars: centsToDollarString(p.price_cents),
      cost_dollars: centsToDollarString(p.cost_cents),
      stock_quantity: String(p.stock_quantity),
      reorder_point: String(p.reorder_point),
      manufacturer: p.manufacturer ?? "", vendor: p.vendor ?? "",
      active: p.active,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name required");
      const price = parseDollarsToCents(form.price_dollars);
      const cost = parseDollarsToCents(form.cost_dollars);
      if (price == null || cost == null) throw new Error("Invalid price/cost");
      const payload = {
        name: form.name.trim(), sku: form.sku.trim() || null,
        category: form.category, description: form.description.trim() || null,
        price_cents: price, cost_cents: cost,
        stock_quantity: Math.max(0, parseInt(form.stock_quantity) || 0),
        reorder_point: Math.max(0, parseInt(form.reorder_point) || 0),
        manufacturer: form.manufacturer.trim() || null,
        vendor: form.vendor.trim() || null,
        active: form.active, organization_id: orgId!,
      };
      if (editing) {
        const { error } = await supabase.from("retail_products").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("retail_products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Product updated" : "Product created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["retail-products", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Product) => {
      const { error } = await supabase.from("retail_products").update({ active: !p.active }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retail-products", orgId] }),
  });

  return (
    <>
      {showHeader && (
        <PageHeader
          title="Retail Products"
          description="Manage products available in the store"
          actions={<Button onClick={openCreate}><Plus className="h-4 w-4" /> New Product</Button>}
        />
      )}

        <div className="rounded-lg border border-border bg-surface shadow-card">
          {isLoading ? (
            <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
          ) : products.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={Boxes} title="No products yet"
                description="Add your first product to start selling at the POS."
                action={<Button onClick={openCreate}><Plus className="h-4 w-4" /> New Product</Button>}
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background text-left">
                  <th className="px-[18px] py-[14px] label-eyebrow">Name</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">SKU</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Category</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Price</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Stock</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Status</th>
                  <th className="px-[18px] py-[14px] text-right"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const lowStock = p.stock_quantity <= p.reorder_point;
                  return (
                    <tr key={p.id} className="border-t border-border-subtle hover:bg-background">
                      <td className="px-[18px] py-[14px] font-medium text-foreground">{p.name}</td>
                      <td className="px-[18px] py-[14px] text-text-secondary">{p.sku ?? "—"}</td>
                      <td className="px-[18px] py-[14px] text-text-secondary">
                        {CATEGORIES.find((c) => c.v === p.category)?.l ?? p.category}
                      </td>
                      <td className="px-[18px] py-[14px] text-foreground">{formatCentsShort(p.price_cents)}</td>
                      <td className="px-[18px] py-[14px]">
                        <span className={lowStock ? "text-warning font-medium inline-flex items-center gap-1" : "text-foreground"}>
                          {lowStock && <AlertTriangle className="h-3.5 w-3.5" />}
                          {p.stock_quantity}
                        </span>
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
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">{editing ? "Edit Product" : "New Product"}</DialogTitle>
            <DialogDescription>Product details and inventory.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">SKU</Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Price *</Label>
                <Input inputMode="decimal" value={form.price_dollars} onChange={(e) => setForm({ ...form, price_dollars: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Cost</Label>
                <Input inputMode="decimal" value={form.cost_dollars} onChange={(e) => setForm({ ...form, cost_dollars: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Stock Quantity</Label>
                <Input inputMode="numeric" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Reorder Point</Label>
                <Input inputMode="numeric" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Manufacturer</Label>
                <Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Vendor</Label>
                <Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></div>
            </div>
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

export default function PosProducts() {
  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PosProductsSection />
      </div>
    </PortalLayout>
  );
}
