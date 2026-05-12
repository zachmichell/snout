import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Groomer } from "@/hooks/useGroomers";

/**
 * Per-day-of-week working-hours editor for a single groomer.
 *
 * Reads existing rows from `groomer_working_hours` (one row per day_of_week)
 * and writes them back as an upsert + delete-of-removed-rows on save.
 *
 * day_of_week 0 = Sunday … 6 = Saturday (matches Postgres EXTRACT(DOW)).
 */

const DAYS = [
  { dow: 1, label: "Monday" },
  { dow: 2, label: "Tuesday" },
  { dow: 3, label: "Wednesday" },
  { dow: 4, label: "Thursday" },
  { dow: 5, label: "Friday" },
  { dow: 6, label: "Saturday" },
  { dow: 0, label: "Sunday" },
];

type DayState = {
  enabled: boolean;
  startTime: string;  // "HH:mm"
  endTime: string;    // "HH:mm"
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groomer: Groomer | null;
};

export default function GroomerHoursDialog({ open, onOpenChange, groomer }: Props) {
  const qc = useQueryClient();

  const { data: existing = [] } = useQuery({
    queryKey: ["groomer-working-hours", groomer?.id],
    enabled: open && !!groomer?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("groomer_working_hours")
        .select("day_of_week, start_time, end_time")
        .eq("groomer_id", groomer!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Map existing rows into a 7-row local state. Time strings come from
  // Postgres as "HH:MM:SS"; chop to "HH:MM" for the <input type="time">.
  const initial = useMemo<Record<number, DayState>>(() => {
    const map: Record<number, DayState> = {};
    for (const d of DAYS) {
      map[d.dow] = { enabled: false, startTime: "08:00", endTime: "17:00" };
    }
    for (const row of existing as any[]) {
      map[row.day_of_week] = {
        enabled: true,
        startTime: (row.start_time ?? "08:00").slice(0, 5),
        endTime: (row.end_time ?? "17:00").slice(0, 5),
      };
    }
    return map;
  }, [existing]);

  const [days, setDays] = useState<Record<number, DayState>>(initial);

  // Reset local state whenever the dialog reopens or existing data refreshes.
  useEffect(() => {
    if (open) setDays(initial);
  }, [open, initial]);

  const update = (dow: number, patch: Partial<DayState>) => {
    setDays((d) => ({ ...d, [dow]: { ...d[dow], ...patch } }));
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!groomer) return;

      // Validate enabled rows: end > start.
      for (const d of DAYS) {
        const r = days[d.dow];
        if (r.enabled && r.startTime >= r.endTime) {
          throw new Error(`${d.label}: end time must be after start time.`);
        }
      }

      // 1. Upsert rows for each enabled day.
      const upsertRows = DAYS.filter((d) => days[d.dow].enabled).map((d) => ({
        groomer_id: groomer.id,
        day_of_week: d.dow,
        start_time: `${days[d.dow].startTime}:00`,
        end_time: `${days[d.dow].endTime}:00`,
      }));
      if (upsertRows.length > 0) {
        const { error } = await supabase
          .from("groomer_working_hours")
          .upsert(upsertRows, { onConflict: "groomer_id,day_of_week" });
        if (error) throw error;
      }

      // 2. Delete rows for days that are now off. We could compute the
      //    diff client-side, but a single delete-where-not-in is simpler
      //    and atomic-enough for staff workflows.
      const enabledDows = DAYS.filter((d) => days[d.dow].enabled).map((d) => d.dow);
      if (enabledDows.length === 0) {
        const { error } = await supabase
          .from("groomer_working_hours")
          .delete()
          .eq("groomer_id", groomer.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("groomer_working_hours")
          .delete()
          .eq("groomer_id", groomer.id)
          .not("day_of_week", "in", `(${enabledDows.join(",")})`);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groomer-working-hours", groomer?.id] });
      toast.success("Working hours saved");
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast.error(e.message ?? "Couldn't save hours");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Working Hours</DialogTitle>
          <DialogDescription>
            Set which days {groomer?.display_name ?? "this groomer"} works and the start/end times for each day. Times are local to your facility.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {DAYS.map((d) => {
            const row = days[d.dow];
            return (
              <div
                key={d.dow}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex w-24 shrink-0 items-center gap-2">
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(v) => update(d.dow, { enabled: v })}
                  />
                  <span className={`text-sm font-medium ${row.enabled ? "text-foreground" : "text-text-tertiary"}`}>
                    {d.label}
                  </span>
                </div>
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    type="time"
                    value={row.startTime}
                    disabled={!row.enabled}
                    onChange={(e) => update(d.dow, { startTime: e.target.value })}
                    className="h-9"
                  />
                  <span className="text-xs text-text-tertiary">to</span>
                  <Input
                    type="time"
                    value={row.endTime}
                    disabled={!row.enabled}
                    onChange={(e) => update(d.dow, { endTime: e.target.value })}
                    className="h-9"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save Hours"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
