import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const DAYS = [
  { id: 0, label: "Sunday" },
  { id: 1, label: "Monday" },
  { id: 2, label: "Tuesday" },
  { id: 3, label: "Wednesday" },
  { id: 4, label: "Thursday" },
  { id: 5, label: "Friday" },
  { id: 6, label: "Saturday" },
];

type HoursRow = {
  id?: string;
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  closed: boolean;
};

const DEFAULT_HOURS: Record<number, { open: string; close: string }> = {
  0: { open: "09:00", close: "17:00" },
  1: { open: "07:00", close: "19:00" },
  2: { open: "07:00", close: "19:00" },
  3: { open: "07:00", close: "19:00" },
  4: { open: "07:00", close: "19:00" },
  5: { open: "07:00", close: "19:00" },
  6: { open: "09:00", close: "17:00" },
};

function emptyWeek(): HoursRow[] {
  return DAYS.map((d) => ({
    day_of_week: d.id,
    open_time: DEFAULT_HOURS[d.id].open,
    close_time: DEFAULT_HOURS[d.id].close,
    closed: d.id === 0, // Sunday closed by default
  }));
}

export default function LocationHoursDialog({
  locationId,
  locationName,
  open,
  onOpenChange,
}: {
  locationId: string | null;
  locationName?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [rows, setRows] = useState<HoursRow[]>(emptyWeek());

  const { data, isLoading } = useQuery({
    queryKey: ["location-hours", locationId],
    enabled: !!locationId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("location_hours")
        .select("id, day_of_week, open_time, close_time, closed")
        .eq("location_id", locationId!)
        .order("day_of_week");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!open) return;
    const base = emptyWeek();
    const byDay = new Map((data ?? []).map((r: any) => [r.day_of_week, r]));
    setRows(
      base.map((b) => {
        const ex = byDay.get(b.day_of_week);
        return ex
          ? {
              id: ex.id,
              day_of_week: b.day_of_week,
              open_time: ex.open_time?.slice(0, 5) ?? b.open_time,
              close_time: ex.close_time?.slice(0, 5) ?? b.close_time,
              closed: !!ex.closed,
            }
          : b;
      }),
    );
  }, [data, open]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!locationId || !orgId) throw new Error("Missing context");
      // Upsert each row (location_id+day_of_week is UNIQUE).
      const payload = rows.map((r) => ({
        organization_id: orgId,
        location_id: locationId,
        day_of_week: r.day_of_week,
        open_time: r.closed ? null : r.open_time,
        close_time: r.closed ? null : r.close_time,
        closed: r.closed,
      }));
      const { error } = await supabase
        .from("location_hours")
        .upsert(payload, { onConflict: "location_id,day_of_week" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hours saved");
      qc.invalidateQueries({ queryKey: ["location-hours", locationId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save hours"),
  });

  const update = (day: number, patch: Partial<HoursRow>) => {
    setRows((rs) => rs.map((r) => (r.day_of_week === day ? { ...r, ...patch } : r)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Operating hours</DialogTitle>
          <DialogDescription>
            {locationName ? `Set weekly hours for ${locationName}.` : "Set weekly hours."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-text-secondary">Loading…</div>
        ) : (
          <div className="space-y-2">
            {DAYS.map((d) => {
              const row = rows.find((r) => r.day_of_week === d.id)!;
              return (
                <div
                  key={d.id}
                  className="grid grid-cols-[110px_70px_1fr] items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <span className="text-sm font-medium text-foreground">{d.label}</span>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!row.closed}
                      onCheckedChange={(v) => update(d.id, { closed: !v })}
                    />
                    <span className="text-[11px] uppercase tracking-wide text-text-secondary">
                      {row.closed ? "Closed" : "Open"}
                    </span>
                  </div>
                  {row.closed ? (
                    <span className="text-xs text-text-tertiary">—</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={row.open_time ?? ""}
                        onChange={(e) => update(d.id, { open_time: e.target.value })}
                        className="h-8 w-[120px]"
                      />
                      <span className="text-xs text-text-tertiary">to</span>
                      <Input
                        type="time"
                        value={row.close_time ?? ""}
                        onChange={(e) => update(d.id, { close_time: e.target.value })}
                        className="h-8 w-[120px]"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? "Saving…" : "Save hours"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
