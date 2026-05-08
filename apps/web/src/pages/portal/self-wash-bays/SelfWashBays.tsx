// Self-wash bay management section. Lists the org's wash bays and lets
// admins add, edit, archive, or take a bay out for maintenance.
//
// Mirrors the shape of kennel_runs / playgroups admin sections but
// stripped to the essentials: each bay is a single named physical
// resource with capacity 1. Pricing and duration live on the
// self_wash service entries (operator creates a "30-minute wash"
// service in the regular Services editor with module='self_wash');
// the bay is just the location side of the booking.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Archive, Wrench, Droplets } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/portal/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";

type Bay = {
  id: string;
  organization_id: string;
  location_id: string | null;
  name: string;
  description: string | null;
  status: "active" | "maintenance";
  active: boolean;
  created_at: string;
  updated_at: string;
};

type LocationOption = { id: string; name: string };

export function SelfWashBaysSection() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";
  const [editing, setEditing] = useState<Bay | null>(null);
  const [open, setOpen] = useState(false);

  const { data: bays = [], isLoading } = useQuery({
    queryKey: ["self-wash-bays", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("self_wash_bays")
        .select("*")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Bay[];
    },
  });

  // Locations for the editor's optional per-location scope.
  const { data: locations = [] } = useQuery({
    queryKey: ["self-wash-bays-locations", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<LocationOption[]> => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as LocationOption[];
    },
  });

  const archive = useMutation({
    mutationFn: async (bay: Bay) => {
      const { error } = await supabase
        .from("self_wash_bays")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", bay.id);
      if (error) throw error;
      await logActivity({
        organization_id: orgId,
        action: "deleted",
        entity_type: "settings",
        entity_id: bay.id,
        metadata: { summary: `Archived self-wash bay "${bay.name}"` },
      });
    },
    onSuccess: () => {
      toast.success("Bay archived");
      qc.invalidateQueries({ queryKey: ["self-wash-bays", orgId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Archive failed"),
  });

  const toggleMaintenance = useMutation({
    mutationFn: async (bay: Bay) => {
      const next = bay.status === "active" ? "maintenance" : "active";
      const { error } = await supabase
        .from("self_wash_bays")
        .update({ status: next })
        .eq("id", bay.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["self-wash-bays", orgId] });
    },
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg text-foreground">Self-wash bays</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Each bay is a physical wash station that customers rent for a
            chunk of time. Pricing and duration come from a self-wash
            service in the Services tab; this section just manages the bays
            themselves.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> New Bay
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-surface shadow-card">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
        ) : bays.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Droplets}
              title="No self-wash bays yet"
              description="Add your first bay to make self-wash bookings available."
              action={
                <Button
                  onClick={() => {
                    setEditing(null);
                    setOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" /> New Bay
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {bays.map((b) => {
              const locName = locations.find((l) => l.id === b.location_id)?.name;
              return (
                <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium text-foreground">{b.name}</span>
                      {b.status === "maintenance" && (
                        <Badge
                          variant="outline"
                          className="border-warning text-warning"
                        >
                          maintenance
                        </Badge>
                      )}
                      {locName && (
                        <span className="text-xs text-text-tertiary">{locName}</span>
                      )}
                    </div>
                    {b.description && (
                      <p className="mt-0.5 truncate text-xs text-text-secondary">
                        {b.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title={
                        b.status === "active"
                          ? "Take out for maintenance"
                          : "Mark active"
                      }
                      onClick={() => toggleMaintenance.mutate(b)}
                    >
                      <Wrench className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(b);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => {
                        if (confirm(`Archive "${b.name}"?`)) archive.mutate(b);
                      }}
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {open && (
        <BayFormDialog
          orgId={orgId}
          existing={editing}
          locations={locations}
          onClose={() => {
            setOpen(false);
            setEditing(null);
          }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["self-wash-bays", orgId] })}
        />
      )}
    </>
  );
}

function BayFormDialog({
  orgId,
  existing,
  locations,
  onClose,
  onSaved,
}: {
  orgId: string;
  existing: Bay | null;
  locations: LocationOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [locationId, setLocationId] = useState(existing?.location_id ?? "__org__");
  const [active, setActive] = useState(existing?.active ?? true);

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      const payload = {
        organization_id: orgId,
        name: name.trim(),
        description: description.trim() || null,
        location_id: locationId === "__org__" ? null : locationId,
        active,
      };
      if (existing) {
        const { error } = await supabase
          .from("self_wash_bays")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("self_wash_bays").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(existing ? "Bay updated" : "Bay created");
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit bay" : "New self-wash bay"}</DialogTitle>
          <DialogDescription>
            Each bay represents one physical wash station and holds one
            customer at a time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bay 1"
            />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Front-room bay with hydraulic table"
              rows={3}
            />
          </div>
          {locations.length > 0 && (
            <div>
              <Label className="text-xs">Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__org__">All locations</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} id="bay-active" />
            <Label htmlFor="bay-active" className="text-sm">
              Active
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : existing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
