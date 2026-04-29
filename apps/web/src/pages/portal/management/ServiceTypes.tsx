import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Power, Layers } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import ModuleBadge from "@/components/portal/ModuleBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrgModules } from "@/hooks/useOrgModules";
import {
  centsToDollarString,
  parseDollarsToCents,
  formatCentsShort,
  formatDurationType,
} from "@/lib/money";

type Service = {
  id: string;
  name: string;
  module: string;
  duration_type: string;
  duration_minutes: number | null;
  base_price_cents: number;
  description: string | null;
  is_addon: boolean;
  active: boolean;
  location_id: string | null;
};

function emptyForm() {
  return {
    name: "",
    module: "daycare",
    description: "",
    duration_type: "full_day",
    duration_minutes: "",
    base_price_dollars: "0.00",
    is_addon: false,
    active: true,
    location_id: "",
  };
}

export default function ServiceTypes() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const { data: enabledModules } = useOrgModules();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: locations = [] } = useQuery({
    queryKey: ["service-types-locations", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from("locations")
        .select("id, name")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("name");
      return data ?? [];
    },
  });

  const { data: services = [], isLoading } = useQuery({
    queryKey: ["service-types", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select(
          "id, name, module, duration_type, duration_minutes, base_price_cents, description, is_addon, active, location_id",
        )
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("module")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Service[];
    },
  });

  const openCreate = () => {
    setEditing(null);
    const f = emptyForm();
    if (locations[0]) f.location_id = locations[0].id;
    setForm(f);
    setOpen(true);
  };

  const openEdit = (s: Service) => {
    setEditing(s);
    setForm({
      name: s.name,
      module: s.module,
      description: s.description ?? "",
      duration_type: s.duration_type,
      duration_minutes: s.duration_minutes != null ? String(s.duration_minutes) : "",
      base_price_dollars: centsToDollarString(s.base_price_cents),
      is_addon: s.is_addon,
      active: s.active,
      location_id: s.location_id ?? "",
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name required");
      const cents = parseDollarsToCents(form.base_price_dollars);
      if (cents == null) throw new Error("Invalid price");
      const minutes = form.duration_minutes ? Number(form.duration_minutes) : null;
      if (minutes != null && (!Number.isInteger(minutes) || minutes < 0)) {
        throw new Error("Duration must be a whole number of minutes");
      }
      const payload: any = {
        name: form.name.trim(),
        module: form.module,
        description: form.description.trim() || null,
        duration_type: form.duration_type,
        duration_minutes: minutes,
        base_price_cents: cents,
        is_addon: form.is_addon,
        active: form.active,
        location_id: form.location_id || null,
        organization_id: orgId!,
      };
      if (editing) {
        const { error } = await supabase.from("services").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("services").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Service updated" : "Service created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["service-types", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (s: Service) => {
      const { error } = await supabase
        .from("services")
        .update({ active: !s.active })
        .eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-types", orgId] }),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Service Types"
          description="Configure the services and add-ons your organization offers"
          actions={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> New Service Type
            </Button>
          }
        />

        <div className="rounded-lg border border-border bg-surface shadow-card">
          {isLoading ? (
            <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
          ) : services.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Layers}
                title="No service types yet"
                description="Add your first service type to define what your organization offers."
                action={
                  <Button onClick={openCreate}>
                    <Plus className="h-4 w-4" /> New Service Type
                  </Button>
                }
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background text-left">
                  <th className="px-[18px] py-[14px] label-eyebrow">Name</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Category</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Type</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Duration</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Base Price</th>
                  <th className="px-[18px] py-[14px] label-eyebrow">Status</th>
                  <th className="px-[18px] py-[14px] label-eyebrow text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className="border-t border-border-subtle hover:bg-background">
                    <td className="px-[18px] py-[14px]">
                      <div className="font-medium text-foreground">{s.name}</div>
                      {s.description && (
                        <div className="text-xs text-text-tertiary line-clamp-1">{s.description}</div>
                      )}
                    </td>
                    <td className="px-[18px] py-[14px]">
                      <ModuleBadge module={s.module as any} />
                    </td>
                    <td className="px-[18px] py-[14px]">
                      {s.is_addon ? (
                        <Badge variant="outline" className="border-accent text-accent">
                          Add-on
                        </Badge>
                      ) : (
                        <span className="text-xs text-text-tertiary">Primary</span>
                      )}
                    </td>
                    <td className="px-[18px] py-[14px] text-text-secondary">
                      {s.duration_minutes
                        ? `${s.duration_minutes} min`
                        : formatDurationType(s.duration_type)}
                    </td>
                    <td className="px-[18px] py-[14px] text-foreground">
                      {formatCentsShort(s.base_price_cents)}
                    </td>
                    <td className="px-[18px] py-[14px]">
                      <Badge
                        variant="outline"
                        className={
                          s.active ? "border-success text-success" : "text-text-tertiary"
                        }
                      >
                        {s.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-[18px] py-[14px] text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate(s)}>
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editing ? "Edit Service Type" : "New Service Type"}
            </DialogTitle>
            <DialogDescription>
              These appear in your Services list and the booking flow.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Full Day Daycare"
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
                <Label className="text-xs">Category *</Label>
                <Select
                  value={form.module}
                  onValueChange={(v) => setForm({ ...form, module: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(!enabledModules || enabledModules.has("daycare")) && (
                      <SelectItem value="daycare">Daycare</SelectItem>
                    )}
                    {(!enabledModules || enabledModules.has("boarding")) && (
                      <SelectItem value="boarding">Boarding</SelectItem>
                    )}
                    {(!enabledModules || enabledModules.has("grooming")) && (
                      <SelectItem value="grooming">Grooming</SelectItem>
                    )}
                    {(!enabledModules || enabledModules.has("training")) && (
                      <SelectItem value="training">Training</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Duration Type *</Label>
                <Select
                  value={form.duration_type}
                  onValueChange={(v) => setForm({ ...form, duration_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="half_day">Half Day</SelectItem>
                    <SelectItem value="full_day">Full Day</SelectItem>
                    <SelectItem value="overnight">Overnight</SelectItem>
                    <SelectItem value="multi_night">Multi-Night</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Duration (minutes)</Label>
                <Input
                  inputMode="numeric"
                  value={form.duration_minutes}
                  onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Base Price *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">
                    $
                  </span>
                  <Input
                    inputMode="decimal"
                    value={form.base_price_dollars}
                    onChange={(e) => setForm({ ...form, base_price_dollars: e.target.value })}
                    className="pl-7"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Location</Label>
              <Select
                value={form.location_id}
                onValueChange={(v) => setForm({ ...form, location_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.is_addon}
                  onCheckedChange={(v) => setForm({ ...form, is_addon: v })}
                />
                <Label className="text-sm">Add-on service</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.active}
                  onCheckedChange={(v) => setForm({ ...form, active: v })}
                />
                <Label className="text-sm">Active</Label>
              </div>
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
