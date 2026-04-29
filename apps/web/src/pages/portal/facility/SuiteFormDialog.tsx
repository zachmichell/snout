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
import { centsToDollarString, parseDollarsToCents } from "@/lib/money";
import type { SuiteRow } from "@/hooks/useSuites";

const SUITE_TYPES = ["standard", "deluxe", "presidential"] as const;

export default function SuiteFormDialog({
  open,
  onOpenChange,
  suite,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suite: SuiteRow | null;
}) {
  const { membership } = useAuth();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [type, setType] = useState<SuiteRow["type"]>("standard");
  const [capacity, setCapacity] = useState("1");
  const [rateDollars, setRateDollars] = useState("0.00");
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (open) {
      if (suite) {
        setName(suite.name);
        setType(suite.type);
        setCapacity(String(suite.capacity));
        setRateDollars(centsToDollarString(suite.daily_rate_cents));
        setActive(suite.status === "active");
      } else {
        setName("");
        setType("standard");
        setCapacity("1");
        setRateDollars("0.00");
        setActive(true);
      }
    }
  }, [open, suite]);

  const save = useMutation({
    mutationFn: async () => {
      if (!membership?.organization_id) throw new Error("No organization");
      if (!name.trim()) throw new Error("Suite name is required");
      const cap = parseInt(capacity, 10);
      if (!Number.isFinite(cap) || cap < 1) throw new Error("Capacity must be at least 1");
      const cents = parseDollarsToCents(rateDollars) ?? 0;

      const payload = {
        name: name.trim(),
        type,
        capacity: cap,
        daily_rate_cents: cents,
        status: active ? ("active" as const) : ("inactive" as const),
        organization_id: membership.organization_id,
      };

      if (suite) {
        const { error } = await supabase.from("suites").update(payload).eq("id", suite.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("suites").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suites"] });
      toast.success(suite ? "Suite updated" : "Suite created");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            {suite ? "Edit suite" : "Add suite"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="su-name">Suite name</Label>
            <Input
              id="su-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Suite 101"
              maxLength={80}
            />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as SuiteRow["type"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUITE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="su-cap">Capacity</Label>
            <Input
              id="su-cap"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="su-rate">Daily rate</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">
                $
              </span>
              <Input
                id="su-rate"
                type="number"
                min={0}
                step="0.01"
                value={rateDollars}
                onChange={(e) => setRateDollars(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <Label htmlFor="su-active" className="cursor-pointer">
              Active
            </Label>
            <Switch id="su-active" checked={active} onCheckedChange={setActive} />
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
