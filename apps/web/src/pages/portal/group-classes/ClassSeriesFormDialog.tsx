import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dayLong, formatInstanceDateTime } from "@/lib/classes";

/**
 * Create a multi-week class series: a class type + a start date + time +
 * a number of weekly sessions. Inserts the class_series row, then generates
 * one class_instance per week (tagged with series_id + session_number).
 */
export default function ClassSeriesFormDialog({
  open,
  onOpenChange,
  defaultClassTypeId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultClassTypeId?: string;
}) {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";

  const [classTypeId, setClassTypeId] = useState(defaultClassTypeId ?? "");
  const [startDate, setStartDate] = useState("");
  const [time, setTime] = useState("");
  const [sessionCount, setSessionCount] = useState("6");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setClassTypeId(defaultClassTypeId ?? "");
      setStartDate("");
      setTime("");
      setSessionCount("6");
      setNotes("");
    }
  }, [open, defaultClassTypeId]);

  const { data: classTypes = [] } = useQuery({
    queryKey: ["class-types", orgId, "active-series"],
    enabled: !!orgId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_types")
        .select("id, name, duration_minutes, instructor_user_id, location_id, schedule_time")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Prefill the time from the class type's suggested schedule_time, if any.
  useEffect(() => {
    const ct = classTypes.find((c: any) => c.id === classTypeId);
    if (ct?.schedule_time && !time) setTime(String(ct.schedule_time).slice(0, 5));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classTypeId, classTypes]);

  const sessionsNum = parseInt(sessionCount, 10);

  const previewDates: Date[] = (() => {
    if (!startDate || !time || Number.isNaN(sessionsNum) || sessionsNum < 1) return [];
    const out: Date[] = [];
    for (let i = 0; i < Math.min(sessionsNum, 52); i++) {
      const d = new Date(`${startDate}T${time}`);
      if (Number.isNaN(d.getTime())) return [];
      d.setDate(d.getDate() + i * 7);
      out.push(d);
    }
    return out;
  })();

  const create = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No organization");
      if (!classTypeId) throw new Error("Pick a class type");
      if (!startDate || !time) throw new Error("Start date and time are required");
      if (Number.isNaN(sessionsNum) || sessionsNum < 1 || sessionsNum > 52)
        throw new Error("Sessions must be between 1 and 52");
      const ct = classTypes.find((c: any) => c.id === classTypeId);
      if (!ct) throw new Error("Class type not found");

      const first = new Date(`${startDate}T${time}`);
      if (Number.isNaN(first.getTime())) throw new Error("Invalid start date/time");
      const weekday = first.getDay();
      const duration = ct.duration_minutes ?? 60;

      // 1) Create the series.
      const { data: series, error: seriesErr } = await supabase
        .from("class_series")
        .insert({
          organization_id: orgId,
          class_type_id: classTypeId,
          instructor_user_id: ct.instructor_user_id ?? null,
          location_id: ct.location_id ?? null,
          start_date: startDate,
          start_time: time,
          weekday,
          session_count: sessionsNum,
          status: "active",
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (seriesErr) throw seriesErr;

      // 2) Generate one weekly session per week.
      const rows = [];
      for (let i = 0; i < sessionsNum; i++) {
        const start = new Date(`${startDate}T${time}`);
        start.setDate(start.getDate() + i * 7);
        const end = new Date(start.getTime() + duration * 60_000);
        rows.push({
          organization_id: orgId,
          class_type_id: classTypeId,
          instructor_user_id: ct.instructor_user_id ?? null,
          location_id: ct.location_id ?? null,
          series_id: series.id,
          session_number: i + 1,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          status: "scheduled",
          auto_generated: true,
          notes: notes.trim() || null,
        });
      }
      const { error: instErr } = await supabase.from("class_instances").insert(rows);
      if (instErr) throw instErr;

      await logActivity({
        organization_id: orgId,
        action: "created",
        entity_type: "class_series",
        entity_id: series.id,
        metadata: { class_type_id: classTypeId, session_count: sessionsNum, start_date: startDate },
      });
    },
    onSuccess: () => {
      toast.success(`Series created — ${sessionsNum} sessions scheduled`);
      qc.invalidateQueries({ queryKey: ["class-instances"] });
      qc.invalidateQueries({ queryKey: ["class-series"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to create series"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Create a Class Series</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div>
            <Label>Class Type</Label>
            <Select value={classTypeId} onValueChange={setClassTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a class type" />
              </SelectTrigger>
              <SelectContent>
                {classTypes.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>First date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <Label>Sessions</Label>
              <Input
                type="number"
                min={1}
                max={52}
                value={sessionCount}
                onChange={(e) => setSessionCount(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          {previewDates.length > 0 && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1.5">
                {previewDates.length} weekly sessions on {dayLong(previewDates[0].getDay())}s
              </div>
              <div className="text-xs text-text-secondary space-y-0.5 max-h-32 overflow-auto">
                {previewDates.map((d, i) => (
                  <div key={i}>
                    {i + 1}. {formatInstanceDateTime(d.toISOString())}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create Series"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
