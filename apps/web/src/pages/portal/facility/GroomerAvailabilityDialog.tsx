import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { Groomer } from "@/hooks/useGroomers";

/**
 * Calendar-driven per-date availability editor.
 *
 * One row in `groomer_availability` per (groomer_id, date) pair. Days the
 * groomer's available are colored on the grid; tapping a day toggles it on
 * or off. The right pane edits the hours for whichever day is selected,
 * plus exposes a bulk action: "Apply these hours to every <weekday> in this
 * month" — fast way to fill out a regular schedule, then customize.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DEFAULT_START = "08:00";
const DEFAULT_END = "17:00";

type AvailabilityRow = {
  date: string;          // "yyyy-MM-dd"
  start_time: string;    // "HH:mm:ss"
  end_time: string;      // "HH:mm:ss"
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groomer: Groomer | null;
};

export default function GroomerAvailabilityDialog({ open, onOpenChange, groomer }: Props) {
  const qc = useQueryClient();
  const [displayedMonth, setDisplayedMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingStart, setEditingStart] = useState(DEFAULT_START);
  const [editingEnd, setEditingEnd] = useState(DEFAULT_END);

  // Fetch the next 4 months of availability so navigating prev/next month
  // doesn't flicker. We refetch when the dialog opens or the groomer changes.
  const fetchStart = useMemo(() => addMonths(startOfMonth(new Date()), -1), []);
  const fetchEnd = useMemo(() => addMonths(startOfMonth(new Date()), 4), []);

  const { data: rows = [] } = useQuery({
    queryKey: ["groomer-availability", groomer?.id, isoDate(fetchStart), isoDate(fetchEnd)],
    enabled: open && !!groomer?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("groomer_availability")
        .select("date, start_time, end_time")
        .eq("groomer_id", groomer!.id)
        .gte("date", isoDate(fetchStart))
        .lte("date", isoDate(fetchEnd));
      if (error) throw error;
      return (data ?? []) as AvailabilityRow[];
    },
  });

  /// Map `yyyy-MM-dd` → row for fast lookup.
  const rowByDate = useMemo(() => {
    const map = new Map<string, AvailabilityRow>();
    rows.forEach((r) => map.set(r.date, r));
    return map;
  }, [rows]);

  // When the user picks a date, sync the editor's start/end with whatever
  // is currently saved for that date (or DEFAULT_START / DEFAULT_END if new).
  useEffect(() => {
    if (!selectedDate) return;
    const r = rowByDate.get(selectedDate);
    setEditingStart(r ? r.start_time.slice(0, 5) : DEFAULT_START);
    setEditingEnd(r ? r.end_time.slice(0, 5) : DEFAULT_END);
  }, [selectedDate, rowByDate]);

  // ---- Mutations ----

  const upsertOne = useMutation({
    mutationFn: async (params: { date: string; startTime: string; endTime: string }) => {
      if (!groomer) return;
      if (params.startTime >= params.endTime) {
        throw new Error("End time must be after start time.");
      }
      const { error } = await supabase
        .from("groomer_availability")
        .upsert(
          {
            groomer_id: groomer.id,
            date: params.date,
            start_time: `${params.startTime}:00`,
            end_time: `${params.endTime}:00`,
          },
          { onConflict: "groomer_id,date" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groomer-availability", groomer?.id] });
    },
    onError: (e: any) => {
      toast.error(e.message ?? "Couldn't save availability");
    },
  });

  const deleteOne = useMutation({
    mutationFn: async (date: string) => {
      if (!groomer) return;
      const { error } = await supabase
        .from("groomer_availability")
        .delete()
        .eq("groomer_id", groomer.id)
        .eq("date", date);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groomer-availability", groomer?.id] });
    },
    onError: (e: any) => {
      toast.error(e.message ?? "Couldn't remove availability");
    },
  });

  const bulkApplyWeekday = useMutation({
    mutationFn: async (params: { weekday: number; startTime: string; endTime: string }) => {
      if (!groomer) return;
      if (params.startTime >= params.endTime) {
        throw new Error("End time must be after start time.");
      }
      const monthStart = displayedMonth;
      const monthEnd = endOfMonth(displayedMonth);
      const targets: { groomer_id: string; date: string; start_time: string; end_time: string }[] = [];
      const cursor = new Date(monthStart);
      while (cursor <= monthEnd) {
        if (cursor.getDay() === params.weekday) {
          targets.push({
            groomer_id: groomer.id,
            date: isoDate(cursor),
            start_time: `${params.startTime}:00`,
            end_time: `${params.endTime}:00`,
          });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      if (targets.length === 0) return;
      const { error } = await supabase
        .from("groomer_availability")
        .upsert(targets, { onConflict: "groomer_id,date" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groomer-availability", groomer?.id] });
      toast.success("Applied to every matching day this month");
    },
    onError: (e: any) => {
      toast.error(e.message ?? "Bulk apply failed");
    },
  });

  // ---- Render helpers ----

  const days = useMemo(() => buildMonthCells(displayedMonth), [displayedMonth]);
  const monthLabel = displayedMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const selectedRow = selectedDate ? rowByDate.get(selectedDate) : undefined;
  const selectedIsAvailable = !!selectedRow;
  const selectedWeekday = selectedDate ? new Date(selectedDate + "T00:00:00").getDay() : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display">Working Calendar</DialogTitle>
          <DialogDescription>
            {groomer?.display_name
              ? `Pick the days ${groomer.display_name} is working. Tap a day to toggle availability and set hours.`
              : "Pick the days this groomer is working."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1fr_300px]">
          {/* Calendar */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDisplayedMonth(addMonths(displayedMonth, -1))}
                className="h-8 w-8 p-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <p className="font-display text-sm font-semibold text-foreground">{monthLabel}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDisplayedMonth(addMonths(displayedMonth, 1))}
                className="h-8 w-8 p-0"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {DAY_NAMES.map((d) => (
                <div key={d} className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {d}
                </div>
              ))}
              {days.map((cell, i) => {
                if (!cell.date) {
                  return <div key={i} className="h-10" />;
                }
                const dateStr = isoDate(cell.date);
                const row = rowByDate.get(dateStr);
                const isAvailable = !!row;
                const isSelected = selectedDate === dateStr;
                const isPast = cell.date < startOfDay(new Date());
                const isToday = isSameDay(cell.date, new Date());
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => !isPast && setSelectedDate(dateStr)}
                    disabled={isPast}
                    className={cn(
                      "h-10 rounded-lg text-sm transition-colors",
                      // Past dates: clearly disabled.
                      isPast && "cursor-not-allowed text-text-tertiary opacity-40",
                      // Off days: no fill, just faded text — visually empty so available stands out.
                      !isPast && !isAvailable && "text-text-tertiary opacity-60 hover:bg-muted/30",
                      // Available days: solid camel tint at 25% opacity + bold weight.
                      // Strong enough to read as "filled in" against the warm card bg.
                      !isPast && isAvailable && "bg-primary/25 text-foreground font-semibold hover:bg-primary/35",
                      // Selected: full camel fill with dark text — wins regardless of availability.
                      isSelected && "!bg-primary !text-primary-foreground !font-semibold",
                      // Today (when not selected): ring accent.
                      isToday && !isSelected && "ring-2 ring-primary/60",
                    )}
                    title={dateStr}
                  >
                    {cell.date.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-4 text-xs text-text-tertiary">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-primary/25" /> Available
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm border border-border" /> Off
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-primary" /> Selected
              </span>
            </div>
          </div>

          {/* Editor pane */}
          <div className="space-y-4 border-l border-border md:pl-6">
            {!selectedDate && (
              <p className="text-sm text-text-secondary">Pick a date on the left to edit hours.</p>
            )}
            {selectedDate && (
              <>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                    {new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {selectedIsAvailable ? "Available" : "Not working"}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-secondary">Start time</label>
                  <Input
                    type="time"
                    value={editingStart}
                    onChange={(e) => setEditingStart(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-secondary">End time</label>
                  <Input
                    type="time"
                    value={editingEnd}
                    onChange={(e) => setEditingEnd(e.target.value)}
                    className="h-9"
                  />
                </div>

                <Button
                  className="w-full"
                  disabled={upsertOne.isPending}
                  onClick={() =>
                    upsertOne.mutate({ date: selectedDate, startTime: editingStart, endTime: editingEnd })
                  }
                >
                  {selectedIsAvailable ? "Save Hours" : "Make Available"}
                </Button>
                {selectedIsAvailable && (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={deleteOne.isPending}
                    onClick={() => deleteOne.mutate(selectedDate)}
                  >
                    Mark as Off
                  </Button>
                )}

                <div className="border-t border-border pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                    Bulk apply
                  </p>
                  {selectedWeekday !== null && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      disabled={bulkApplyWeekday.isPending}
                      onClick={() =>
                        bulkApplyWeekday.mutate({
                          weekday: selectedWeekday,
                          startTime: editingStart,
                          endTime: editingEnd,
                        })
                      }
                    >
                      Apply {editingStart}–{editingEnd} to every {FULL_DAY_NAMES[selectedWeekday]} in {monthLabel}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- date helpers ----

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

type Cell = { date: Date | null };

/// Build a 6-row × 7-col matrix for the given month, padded with nulls.
function buildMonthCells(displayedMonth: Date): Cell[] {
  const first = startOfMonth(displayedMonth);
  const last = endOfMonth(displayedMonth);
  const leadingBlanks = first.getDay();
  const cells: Cell[] = Array(leadingBlanks).fill(null).map(() => ({ date: null }));
  for (let day = 1; day <= last.getDate(); day++) {
    cells.push({ date: new Date(first.getFullYear(), first.getMonth(), day) });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null });
  return cells;
}
