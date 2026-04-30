import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { formatCentsShort } from "@/lib/money";
import { FLAT_SERVICE_DEFAULT_DURATION_MINUTES } from "@/lib/booking";
import type { WizardState } from "./BookingWizard";

/**
 * Slot-picker step (grooming flow). Date input on top, grid of available
 * 15-minute start times below. The slot list comes from the SECURITY DEFINER
 * RPC `get_groomer_available_slots` so the customer never sees other parents'
 * appointments — only the slot strings the function returns.
 */
export default function StepSlot({
  state,
  setState,
  onBack,
  onNext,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  onBack: () => void;
  onNext: () => void;
}) {
  const groomer = state.groomer;
  const svc = state.service;

  const duration =
    svc?.default_duration_minutes ?? FLAT_SERVICE_DEFAULT_DURATION_MINUTES;

  // Pull the set of dates the groomer has any availability row for in the
  // next 90 days. The Calendar grid uses this to disable non-working days.
  const dateRange = useMemo(() => {
    const today = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 90);
    return { start: isoDate(today), end: isoDate(end) };
  }, []);

  const { data: availableDates = new Set<string>(), isLoading: datesLoading } = useQuery({
    queryKey: ["groomer-available-dates", groomer?.id, dateRange.start, dateRange.end],
    enabled: !!groomer?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_groomer_available_dates", {
        p_groomer_id: groomer!.id,
        p_start_date: dateRange.start,
        p_end_date: dateRange.end,
      });
      if (error) throw error;
      const rec = data as { dates?: string[] } | null;
      return new Set(rec?.dates ?? []);
    },
  });

  // Default to the *first available date* once the date set loads, rather
  // than a hardcoded "tomorrow" that might not be a working day for this groomer.
  useEffect(() => {
    if (state.groomingDate) return;
    if (datesLoading) return;
    const first = [...availableDates].sort()[0];
    if (first) {
      setState((s) => ({ ...s, groomingDate: first }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datesLoading, availableDates]);

  const { data: slots = [], isLoading } = useQuery({
    queryKey: ["groomer-slots", groomer?.id, state.groomingDate, duration],
    enabled: !!groomer?.id && !!state.groomingDate,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_groomer_available_slots", {
        p_groomer_id: groomer!.id,
        p_date: state.groomingDate,
        p_duration_minutes: duration,
        p_slot_step_minutes: 15,
      });
      if (error) throw error;
      // RPC returns jsonb { slots: [...] }
      const rec = data as { slots?: string[] } | null;
      return rec?.slots ?? [];
    },
  });

  // Drop a stale pick if the new slot list doesn't contain it.
  useEffect(() => {
    if (state.groomingSlot && !slots.includes(state.groomingSlot)) {
      setState((s) => ({ ...s, groomingSlot: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  const estimate = useMemo(() => {
    if (!svc) return 0;
    // Grooming is flat-priced — base × pet count. v2 will use the per-groomer
    // matrix to vary the duration but the price calc still holds.
    return svc.base_price_cents * Math.max(1, state.pets.length);
  }, [svc, state.pets.length]);

  function isoDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function startOfToday(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  const formatLabel = (slot: string) => {
    const [hh, mm] = slot.split(":");
    const h = Number(hh);
    const m = Number(mm);
    const period = h < 12 ? "AM" : "PM";
    const display = h % 12 === 0 ? 12 : h % 12;
    return `${display}:${String(m).padStart(2, "0")} ${period}`;
  };

  return (
    <div className="space-y-4 py-2">
      {/* Groomer summary */}
      {groomer && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-light text-xs font-semibold text-primary">
            {groomer.display_name
              .split(" ")
              .slice(0, 2)
              .map((p) => p[0]?.toUpperCase() ?? "")
              .join("")}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              With
            </p>
            <p className="truncate text-sm font-medium text-foreground">
              {groomer.display_name}
            </p>
          </div>
        </div>
      )}

      <div>
        <label className="text-sm font-medium text-foreground">Date</label>
        {datesLoading ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading availability…</p>
        ) : availableDates.size === 0 ? (
          <p className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            This groomer doesn't have any open dates in the next 90 days.
          </p>
        ) : (
          <div className="mt-2 inline-block rounded-lg border border-border bg-card p-2">
            <Calendar
              mode="single"
              selected={
                state.groomingDate
                  ? new Date(state.groomingDate + "T00:00:00")
                  : undefined
              }
              onSelect={(d) => {
                if (!d) return;
                const iso = isoDate(d);
                if (!availableDates.has(iso)) return;
                setState((s) => ({ ...s, groomingDate: iso, groomingSlot: null }));
              }}
              disabled={(d) => {
                const iso = isoDate(d);
                return !availableDates.has(iso) || d < startOfToday();
              }}
              initialFocus
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Available times</p>
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading times…</p>
        )}
        {!isLoading && slots.length === 0 && (
          <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            No openings on this date. Try a different day.
          </p>
        )}
        {slots.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((slot) => {
              const isSelected = state.groomingSlot === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, groomingSlot: slot }))}
                  className={cn(
                    "rounded-full border px-3 py-2 text-sm font-semibold transition-colors",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:border-primary",
                  )}
                >
                  {formatLabel(slot)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-primary-light/40 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-foreground">Estimated total</span>
          <span className="font-display text-xl font-semibold text-foreground">
            {formatCentsShort(estimate)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Estimate — final price set by staff when they confirm your booking.
        </p>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button disabled={!state.groomingSlot} onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}
