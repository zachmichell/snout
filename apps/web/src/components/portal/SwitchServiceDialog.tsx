// Reusable Switch service dialog. Extracted from ReservationDetail so
// the same flow can be triggered from a Dashboard row, the
// reservation detail page, or any other place that holds a
// reservation id. Keeps the click-count to 4 from the Dashboard
// (icon -> dropdown -> service item -> Switch).
//
// Owns its own org-services query (gated on `open` so it doesn't run
// for every row on the Dashboard). On submit, writes the new
// service_id, logs the change, and invokes onSaved so the caller can
// invalidate its own queries.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLogActivity } from "@/hooks/useLogActivity";

export interface SwitchServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservationId: string;
  currentServiceId: string | null;
  currentServiceName?: string | null;
  onSaved?: () => void;
}

export default function SwitchServiceDialog({
  open,
  onOpenChange,
  reservationId,
  currentServiceId,
  currentServiceName,
  onSaved,
}: SwitchServiceDialogProps) {
  const { membership } = useAuth();
  const log = useLogActivity();
  const [serviceId, setServiceId] = useState<string>("");

  const { data: services = [] } = useQuery({
    queryKey: ["switch-services", membership?.organization_id],
    enabled: open && !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, module, duration_type, location_id")
        .eq("organization_id", membership!.organization_id)
        .eq("active", true)
        .is("deleted_at", null)
        .order("module")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const submit = async () => {
    if (!serviceId || !membership) return;
    const newService = services.find((s) => s.id === serviceId);
    if (!newService) return toast.error("Service not found");

    const { error } = await supabase
      .from("reservations")
      .update({ service_id: serviceId })
      .eq("id", reservationId);
    if (error) return toast.error(error.message);

    try {
      await log({
        organization_id: membership.organization_id,
        action: "updated",
        entity_type: "reservation",
        entity_id: reservationId,
        metadata: {
          summary: `Service changed from ${currentServiceName ?? "service"} to ${newService.name}`,
          previous_service_id: currentServiceId,
          new_service_id: serviceId,
        },
      });
    } catch (e) {
      // Don't block the user on log failures — the reservation update is
      // what they care about.
      console.warn("activity_log write failed", e);
    }

    toast.success(`Switched to ${newService.name}`);
    setServiceId("");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setServiceId("");
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Switch service</DialogTitle>
          <DialogDescription>
            Pick a different service for this reservation. Times stay the
            same; adjust them from the Edit screen if the new service
            requires it.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Select value={serviceId} onValueChange={setServiceId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a service..." />
            </SelectTrigger>
            <SelectContent>
              {services.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.module})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!serviceId || serviceId === currentServiceId}
          >
            Switch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
