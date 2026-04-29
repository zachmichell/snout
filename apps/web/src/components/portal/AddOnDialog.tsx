import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLogActivity } from "@/hooks/useLogActivity";

/**
 * Quick-add dialog to attach a grooming/training service to a parent
 * (daycare/boarding) reservation. Creates a child reservation with
 * `parent_reservation_id` set to the parent's id.
 *
 * Logs an "updated" activity entry on the parent so staff can see the
 * attachment in the parent's Activity log, and a "created" entry on the
 * child reservation.
 */
export function AddOnDialog({
  open,
  onOpenChange,
  parent,
  petId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  parent: {
    id: string;
    organization_id?: string | null;
    location_id?: string | null;
    primary_owner_id?: string | null;
    start_at: string;
    end_at: string;
  };
  petId: string;
  onSuccess?: () => void;
}) {
  const { membership } = useAuth();
  const log = useLogActivity();
  const qc = useQueryClient();

  const orgId = parent.organization_id ?? membership?.organization_id ?? null;

  const [serviceId, setServiceId] = useState<string>("");
  const [startAt, setStartAt] = useState<string>(toLocalInput(parent.start_at));
  const [durationMin, setDurationMin] = useState<number>(60);

  // Reset on open
  useEffect(() => {
    if (open) {
      setServiceId("");
      setStartAt(toLocalInput(parent.start_at));
      setDurationMin(60);
    }
  }, [open, parent.start_at]);

  // Only services with module = grooming or training can be added on
  const { data: services = [] } = useQuery({
    queryKey: ["addon-services", orgId],
    enabled: !!orgId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, module, duration_minutes")
        .eq("organization_id", orgId!)
        .in("module", ["grooming", "training"])
        .eq("active", true)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // When user picks a service, default duration to its `duration_minutes`
  useEffect(() => {
    const svc = services.find((s) => s.id === serviceId);
    if (svc?.duration_minutes) setDurationMin(svc.duration_minutes);
  }, [serviceId, services]);

  const create = useMutation({
    mutationFn: async () => {
      if (!orgId || !parent.location_id) {
        throw new Error("Missing organization or location");
      }
      if (!serviceId) throw new Error("Pick a service");
      const startIso = new Date(startAt).toISOString();
      const endIso = new Date(new Date(startAt).getTime() + durationMin * 60_000).toISOString();

      const { data: created, error } = await supabase
        .from("reservations")
        .insert({
          organization_id: orgId,
          location_id: parent.location_id,
          service_id: serviceId,
          primary_owner_id: parent.primary_owner_id ?? null,
          parent_reservation_id: parent.id,
          status: "confirmed",
          source: "staff_created",
          start_at: startIso,
          end_at: endIso,
          requested_at: new Date().toISOString(),
          confirmed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;

      await supabase.from("reservation_pets").insert({
        organization_id: orgId,
        reservation_id: created.id,
        pet_id: petId,
      });

      const svc = services.find((s) => s.id === serviceId);
      const summary = `${svc?.name ?? "Service"} attached as add-on`;

      // Log on the parent + on the new child
      await log({
        organization_id: orgId,
        action: "updated",
        entity_type: "reservation",
        entity_id: parent.id,
        metadata: { summary },
      });
      await log({
        organization_id: orgId,
        action: "created",
        entity_type: "reservation",
        entity_id: created.id,
        metadata: { add_on_to: parent.id },
      });

      return created.id;
    },
    onSuccess: () => {
      toast.success("Service added");
      qc.invalidateQueries({ queryKey: ["dashboard-day"] });
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["reservation"] });
      qc.invalidateQueries({ queryKey: ["activity-log"] });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't add service. Try again."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a service</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-text-secondary">
              Service
            </label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger>
                <SelectValue placeholder={services.length ? "Pick a service…" : "Loading…"} />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-text-secondary">
                Start
              </label>
              <Input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-text-secondary">
                Duration (min)
              </label>
              <Input
                type="number"
                min={15}
                step={15}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value) || 0)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !serviceId || !startAt}
            className="gap-1"
          >
            {create.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Attach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLocalInput(iso: string): string {
  // Convert ISO timestamp to the `yyyy-MM-ddTHH:mm` format for <input type="datetime-local">
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
