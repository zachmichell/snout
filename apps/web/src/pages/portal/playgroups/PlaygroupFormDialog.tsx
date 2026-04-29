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

const COLOR_PRESETS = [
  { name: "Cotton Candy", value: "#F2D3C9" },
  { name: "Vanilla", value: "#EED4BB" },
  { name: "Frosted Glass", value: "#CBD5D6" },
  { name: "Morning Mist", value: "#C7D0C5" },
  { name: "Blueberry Cream", value: "#CDB5B1" },
  { name: "Soft Camel", value: "#CBA48F" },
];

export type PlaygroupRow = {
  id: string;
  name: string;
  capacity: number | null;
  color: string;
  active: boolean;
  location_id: string | null;
};

export default function PlaygroupFormDialog({
  open,
  onOpenChange,
  playgroup,
  defaultLocationId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  playgroup: PlaygroupRow | null;
  defaultLocationId: string | null;
}) {
  const { membership } = useAuth();
  const { data: locations = [] } = useLocations();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("8");
  const [color, setColor] = useState(COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)].value);
  const [active, setActive] = useState(true);
  const [locationId, setLocationId] = useState<string | "none">("none");

  useEffect(() => {
    if (open) {
      if (playgroup) {
        setName(playgroup.name);
        setCapacity(String(playgroup.capacity ?? 8));
        setColor(playgroup.color);
        setActive(playgroup.active);
        setLocationId(playgroup.location_id ?? "none");
      } else {
        setName("");
        setCapacity("8");
        setColor(COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)].value);
        setActive(true);
        setLocationId(defaultLocationId ?? "none");
      }
    }
  }, [open, playgroup, defaultLocationId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!membership?.organization_id) throw new Error("No org");
      if (!name.trim()) throw new Error("Name is required");
      const cap = Number(capacity);
      if (!Number.isFinite(cap) || cap < 1) throw new Error("Capacity must be at least 1");

      const payload = {
        name: name.trim(),
        capacity: cap,
        color,
        active,
        location_id: locationId === "none" ? null : locationId,
        organization_id: membership.organization_id,
      };

      if (playgroup) {
        const { error } = await supabase.from("playgroups").update(payload).eq("id", playgroup.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("playgroups").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playgroups"] });
      toast.success(playgroup ? "Playgroup updated" : "Playgroup created");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            {playgroup ? "Edit playgroup" : "Add playgroup"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="pg-name">Name</Label>
            <Input
              id="pg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Small Dogs"
              maxLength={80}
            />
          </div>
          <div>
            <Label htmlFor="pg-cap">Max capacity</Label>
            <Input
              id="pg-cap"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
          <div>
            <Label>Color</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`h-8 w-8 rounded-full border-2 transition-all ${
                    color === c.value ? "border-foreground scale-110" : "border-border"
                  }`}
                  style={{ backgroundColor: c.value }}
                  aria-label={c.name}
                  title={c.name}
                />
              ))}
            </div>
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
            <Label htmlFor="pg-active" className="cursor-pointer">
              Active
            </Label>
            <Switch id="pg-active" checked={active} onCheckedChange={setActive} />
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
