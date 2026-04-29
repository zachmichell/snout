import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Power, CreditCard, Users } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { centsToDollarString, parseDollarsToCents, formatCentsShort } from "@/lib/money";
import { formatDate } from "@/lib/format";

type Pkg = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  billing_cycle: string;
  included_credits: Record<string, number>;
  active: boolean;
  created_at: string;
};

type CreditField = { key: string; label: string };
const CREDIT_FIELDS: CreditField[] = [
  { key: "daycare_days", label: "Daycare Days" },
  { key: "boarding_nights", label: "Boarding Nights" },
  { key: "baths", label: "Baths" },
  { key: "grooming", label: "Grooming Sessions" },
  { key: "training", label: "Training Sessions" },
];

const BILLING_LABEL: Record<string, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

function emptyForm() {
  return {
    name: "",
    description: "",
    price_dollars: "0.00",
    billing_cycle: "one_time",
    credits: {} as Record<string, string>,
    active: true,
  };
}

export default function Subscriptions() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [tab, setTab] = useState("packages");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: packages = [], isLoading } = useQuery({
    queryKey: ["sub-packages", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_packages")
        .select("*")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Pkg[];
    },
  });

  const { data: subscribers = [] } = useQuery({
    queryKey: ["owner-subs", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data: subs, error } = await supabase
        .from("owner_subscriptions")
        .select("id, owner_id, package_id, remaining_credits, status, purchased_at")
        .eq("organization_id", orgId!)
        .order("purchased_at", { ascending: false });
      if (error) throw error;
      const ownerIds = Array.from(new Set((subs ?? []).map((s) => s.owner_id)));
      const pkgIds = Array.from(new Set((subs ?? []).map((s) => s.package_id)));
      const [{ data: owners }, { data: pkgs }] = await Promise.all([
        ownerIds.length
          ? supabase.from("owners").select("id, first_name, last_name, email").in("id", ownerIds)
          : Promise.resolve({ data: [] as any[] }),
        pkgIds.length
          ? supabase.from("subscription_packages").select("id, name").in("id", pkgIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const oMap = new Map((owners ?? []).map((o: any) => [o.id, o]));
      const pMap = new Map((pkgs ?? []).map((p: any) => [p.id, p]));
      return (subs ?? []).map((s: any) => ({
        ...s,
        owner: oMap.get(s.owner_id),
        package: pMap.get(s.package_id),
      }));
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (p: Pkg) => {
    setEditing(p);
    const credits: Record<string, string> = {};
    Object.entries(p.included_credits ?? {}).forEach(([k, v]) => {
      credits[k] = String(v);
    });
    setForm({
      name: p.name,
      description: p.description ?? "",
      price_dollars: centsToDollarString(p.price_cents),
      billing_cycle: p.billing_cycle,
      credits,
      active: p.active,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name required");
      const cents = parseDollarsToCents(form.price_dollars);
      if (cents == null) throw new Error("Invalid price");
      const credits: Record<string, number> = {};
      Object.entries(form.credits).forEach(([k, v]) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) credits[k] = Math.floor(n);
      });
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price_cents: cents,
        billing_cycle: form.billing_cycle,
        included_credits: credits,
        active: form.active,
        organization_id: orgId!,
      };
      if (editing) {
        const { error } = await supabase
          .from("subscription_packages")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("subscription_packages").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Package updated" : "Package created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["sub-packages", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Pkg) => {
      const { error } = await supabase
        .from("subscription_packages")
        .update({ active: !p.active })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sub-packages", orgId] }),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Subscriptions"
          description="Manage credit packages and active subscribers"
          actions={
            tab === "packages" ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> New Package
              </Button>
            ) : null
          }
        />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="packages">Packages</TabsTrigger>
            <TabsTrigger value="subscribers">Active Subscribers</TabsTrigger>
          </TabsList>

          <TabsContent value="packages" className="mt-6">
            <div className="rounded-lg border border-border bg-surface shadow-card">
              {isLoading ? (
                <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
              ) : packages.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={CreditCard}
                    title="No packages yet"
                    description="Create credit packages to offer prepaid services to your customers."
                    action={
                      <Button onClick={openCreate}>
                        <Plus className="h-4 w-4" /> New Package
                      </Button>
                    }
                  />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background text-left">
                      <th className="px-[18px] py-[14px] label-eyebrow">Name</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Credits</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Price</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Billing</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Status</th>
                      <th className="px-[18px] py-[14px] label-eyebrow text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packages.map((p) => (
                      <tr key={p.id} className="border-t border-border-subtle hover:bg-background">
                        <td className="px-[18px] py-[14px]">
                          <div className="font-medium text-foreground">{p.name}</div>
                          {p.description && (
                            <div className="text-xs text-text-tertiary">{p.description}</div>
                          )}
                        </td>
                        <td className="px-[18px] py-[14px] text-text-secondary">
                          {Object.keys(p.included_credits ?? {}).length === 0 ? (
                            <span className="text-text-tertiary">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(p.included_credits ?? {}).map(([k, v]) => (
                                <Badge key={k} variant="outline" className="text-xs">
                                  {v} {CREDIT_FIELDS.find((f) => f.key === k)?.label ?? k}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-[18px] py-[14px] text-foreground">
                          {formatCentsShort(p.price_cents)}
                        </td>
                        <td className="px-[18px] py-[14px] text-text-secondary">
                          {BILLING_LABEL[p.billing_cycle] ?? p.billing_cycle}
                        </td>
                        <td className="px-[18px] py-[14px]">
                          <Badge
                            variant="outline"
                            className={p.active ? "border-success text-success" : "text-text-tertiary"}
                          >
                            {p.active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="px-[18px] py-[14px] text-right">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleActive.mutate(p)}
                          >
                            <Power className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          <TabsContent value="subscribers" className="mt-6">
            <div className="rounded-lg border border-border bg-surface shadow-card">
              {subscribers.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Users}
                    title="No active subscribers"
                    description="When customers purchase packages, they'll appear here."
                  />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background text-left">
                      <th className="px-[18px] py-[14px] label-eyebrow">Owner</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Package</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Remaining Credits</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Status</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Purchased</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscribers.map((s: any) => (
                      <tr key={s.id} className="border-t border-border-subtle hover:bg-background">
                        <td className="px-[18px] py-[14px] font-medium text-foreground">
                          {s.owner ? `${s.owner.first_name} ${s.owner.last_name}` : "—"}
                        </td>
                        <td className="px-[18px] py-[14px] text-text-secondary">
                          {s.package?.name ?? "—"}
                        </td>
                        <td className="px-[18px] py-[14px]">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(s.remaining_credits ?? {}).map(([k, v]) => (
                              <Badge key={k} variant="outline" className="text-xs">
                                {String(v)} {CREDIT_FIELDS.find((f) => f.key === k)?.label ?? k}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-[18px] py-[14px]">
                          <Badge variant="outline">{s.status}</Badge>
                        </td>
                        <td className="px-[18px] py-[14px] text-text-secondary">
                          {formatDate(s.purchased_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editing ? "Edit Package" : "New Package"}
            </DialogTitle>
            <DialogDescription>
              Define included credits and pricing for this package.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. 10-Day Daycare Pass"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Price *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">
                    $
                  </span>
                  <Input
                    inputMode="decimal"
                    value={form.price_dollars}
                    onChange={(e) => setForm({ ...form, price_dollars: e.target.value })}
                    className="pl-7"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Billing Cycle</Label>
                <Select
                  value={form.billing_cycle}
                  onValueChange={(v) => setForm({ ...form, billing_cycle: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">One-time</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Included Credits</Label>
              <div className="grid grid-cols-2 gap-3">
                {CREDIT_FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-[11px] text-text-tertiary">{f.label}</Label>
                    <Input
                      inputMode="numeric"
                      value={form.credits[f.key] ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          credits: { ...form.credits, [f.key]: e.target.value },
                        })
                      }
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
              />
              <Label className="text-sm">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
