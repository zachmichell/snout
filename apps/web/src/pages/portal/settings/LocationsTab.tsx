import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
import { Pencil, Plus, Trash2, Clock } from "lucide-react";
import { TIMEZONE_OPTIONS } from "@/lib/timezones";
import LocationHoursDialog from "@/components/portal/facility/LocationHoursDialog";

type LocationRow = {
  id: string;
  name: string;
  street_address: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: string | null;
  timezone: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
};

const empty: Partial<LocationRow> = {
  name: "",
  street_address: "",
  city: "",
  state_province: "",
  postal_code: "",
  country: "",
  timezone: "",
  phone: "",
  email: "",
};

export default function LocationsTab() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();

  const { data: org } = useQuery({
    queryKey: ["org-defaults", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("country, timezone")
        .eq("id", orgId!)
        .maybeSingle();
      return data;
    },
  });

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["locations", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data as LocationRow[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [form, setForm] = useState<Partial<LocationRow>>(empty);
  const [hoursFor, setHoursFor] = useState<LocationRow | null>(null);

  function openNew() {
    setEditing(null);
    setForm({ ...empty, country: org?.country ?? "", timezone: org?.timezone ?? "" });
    setOpen(true);
  }

  function openEdit(loc: LocationRow) {
    setEditing(loc);
    setForm(loc);
    setOpen(true);
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.name || !form.city || !form.state_province) {
        throw new Error("Name, city, and state/province are required");
      }
      if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) {
        throw new Error("Invalid email");
      }
      const payload = {
        name: form.name!,
        street_address: form.street_address || null,
        city: form.city!,
        state_province: form.state_province!,
        postal_code: form.postal_code || null,
        country: form.country || null,
        timezone: form.timezone || null,
        phone: form.phone || null,
        email: form.email || null,
      };
      const { logActivity } = await import("@/lib/activity");
      if (editing) {
        const { error } = await supabase.from("locations").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logActivity({
          organization_id: orgId!,
          action: "updated",
          entity_type: "location",
          entity_id: editing.id,
          metadata: { name: payload.name },
        });
      } else {
        const { data, error } = await supabase
          .from("locations")
          .insert({ ...payload, organization_id: orgId!, active: true })
          .select("id")
          .single();
        if (error) throw error;
        await logActivity({
          organization_id: orgId!,
          action: "created",
          entity_type: "location",
          entity_id: data.id,
          metadata: { name: payload.name },
        });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Location updated" : "Location added");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["locations", orgId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("locations").update({ active }).eq("id", id);
      if (error) throw error;
      const { logActivity } = await import("@/lib/activity");
      await logActivity({
        organization_id: orgId!,
        action: active ? "activated" : "deactivated",
        entity_type: "location",
        entity_id: id,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locations", orgId] }),
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { data: blocks, error: e1 } = await supabase
        .from("reservations")
        .select("id")
        .eq("location_id", id)
        .is("deleted_at", null)
        .in("status", ["requested", "confirmed", "checked_in"])
        .limit(1);
      if (e1) throw e1;
      if (blocks && blocks.length > 0) {
        throw new Error("Cannot delete: location has active reservations");
      }
      const { error } = await supabase
        .from("locations")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Location deleted");
      qc.invalidateQueries({ queryKey: ["locations", orgId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete"),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add Location
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : locations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  No locations yet.
                </TableCell>
              </TableRow>
            ) : (
              locations.map((loc) => (
                <TableRow key={loc.id}>
                  <TableCell className="font-medium">{loc.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {[loc.city, loc.state_province].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm">{loc.phone || "—"}</TableCell>
                  <TableCell className="text-sm">{loc.email || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={loc.active}
                        onCheckedChange={(v) => toggleActive.mutate({ id: loc.id, active: v })}
                      />
                      <Badge variant={loc.active ? "default" : "secondary"}>
                        {loc.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setHoursFor(loc)}
                      title="Operating hours"
                    >
                      <Clock className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(loc)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Delete location "${loc.name}"?`)) deleteMut.mutate(loc.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editing ? "Edit location" : "Add location"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Name *">
              <Input
                value={form.name ?? ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Street address">
              <Input
                value={form.street_address ?? ""}
                onChange={(e) => setForm({ ...form, street_address: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City *">
                <Input
                  value={form.city ?? ""}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </Field>
              <Field label="State/Province *">
                <Input
                  value={form.state_province ?? ""}
                  onChange={(e) => setForm({ ...form, state_province: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Postal code">
                <Input
                  value={form.postal_code ?? ""}
                  onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
                />
              </Field>
              <Field label="Country">
                <Input
                  value={form.country ?? ""}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Timezone">
              <Select
                value={form.timezone ?? ""}
                onValueChange={(v) => setForm({ ...form, timezone: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <Input
                  value={form.phone ?? ""}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={form.email ?? ""}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LocationHoursDialog
        locationId={hoursFor?.id ?? null}
        locationName={hoursFor?.name}
        open={!!hoursFor}
        onOpenChange={(o) => !o && setHoursFor(null)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
