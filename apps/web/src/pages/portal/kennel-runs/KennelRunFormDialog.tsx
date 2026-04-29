import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useLocations } from "@/hooks/useLocations";
import { centsToDollarString, parseDollarsToCents } from "@/lib/money";

export type KennelRunRow = {
  id: string;
  name: string;
  run_type: "standard" | "large" | "suite" | "indoor" | "outdoor";
  capacity: number;
  daily_rate_modifier_cents: number;
  active: boolean;
  location_id: string | null;
};

const RUN_TYPES = ["standard", "large", "suite", "indoor", "outdoor"] as const;

export default function KennelRunFormDialog({
  open,
  onOpenChange,
  run,
  defaultLocationId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  run: KennelRunRow | null;
  defaultLocationId: string | null;
}) {
  const { membership } = useAuth();
  const { data: locations = [] } = useLocations();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [runType, setRunType] = useState<KennelRunRow["run_type"]>("standard");
  const [rateDollars, setRateDollars] = useState("0.00");
  const [active, setActive] = useState(true);
  const [locationId, setLocationId] = useState<string | "none">("none");

  useEffect(() => {
    if (open) {
      if (run) {
        setName(run.name);
        setRunType(run.run_type);
        setRateDollars(centsToDollarString(run.daily_rate_modifier_cents));
        setActive(run.active);
        setLocationId(run.location_id ?? "none");
      } else {
        setName("");
        setRunType("standard");
        setRateDollars("0.00");
        setActive(true);
        setLocationId(defaultLocationId ?? "none");
      }
    }
  }, [open, run, defaultLocationId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!membership?.organization_id) throw new Error("No org");
      if (!name.trim()) throw new Error("Name is required");
      const cents = parseDollarsToCents(rateDollars) ?? 0;

      const payload = {
        name: name.trim(),
        run_type: runType,
        daily_rate_modifier_cents: cents,
        active,
        location_id: locationId === "none" ? null : locationId,
        organization_id: membership.organization_id,
      };

      if (run) {
        const { error } = await supabase.from("kennel_runs").update(payload).eq("id", run.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("kennel_runs").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kennel-runs"] });
      toast.success(run ? "Kennel run updated" : "Kennel run created");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            {run ? "Edit kennel run" : "Add kennel run"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="kr-name">Name</Label>
            <Input
              id="kr-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Suite A"
              maxLength={80}
            />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={runType} onValueChange={(v) => setRunType(v as KennelRunRow["run_type"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RUN_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="kr-rate">Nightly rate modifier</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">
                $
              </span>
              <Input
                id="kr-rate"
                type="number"
                min={0}
                step="0.01"
                value={rateDollars}
                onChange={(e) => setRateDollars(e.target.value)}
                className="pl-7"
              />
            </div>
            <p className="mt-1 text-xs text-text-tertiary">
              Added to the base nightly rate. Use 0 for the base rate.
            </p>
          </div>
          {locations.length > 1 && (
            <div>
              <Label>Location</Label>
              <Select value={locationId} onValueChange={(v) => setLocationId(v as string)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No location</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <Label htmlFor="kr-active" className="cursor-pointer">
              Active
            </Label>
            <Switch id="kr-active" checked={active} onCheckedChange={setActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
