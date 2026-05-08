import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { formatCentsShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  combineDateTime,
  diffNights,
  estimatePriceCents,
  generateTimeSlots,
  tomorrowISODate,
} from "@/lib/booking";
import type { WizardState } from "./BookingWizard";

// Hardcoded fallbacks used when the facility has no configured hours for the
// selected day. Kept aligned with the prior pre-Cluster-4 behavior so an
// operator that has not set up location_hours sees no regression.
const FALLBACK_START_DAY = "07:00";
const FALLBACK_END_DAY = "18:00";
const FALLBACK_START_OVERNIGHT = "14:00";
const FALLBACK_END_OVERNIGHT = "11:00";
const FALLBACK_START_HOURLY = "09:00";

// Outer boundary used when a facility has no location_hours configured at
// all. Once we have rows we narrow the picker to the actual open window so
// customers can't accidentally pick 4 AM at a 9-to-5 facility.
const PICKER_FALLBACK_START_HOUR = 6;
const PICKER_FALLBACK_END_HOUR = 21;

type LocationHoursRow = {
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  closed: boolean;
};

function clipTime(t: string | null | undefined): string | null {
  if (!t) return null;
  // Database stores "HH:MM:SS" or "HH:MM"; the time inputs in the wizard use HH:MM.
  return t.length >= 5 ? t.slice(0, 5) : t;
}

// "HH:MM" -> hour as integer (rounded down). Returns null on bad input.
function parseHour(t: string | null | undefined): number | null {
  if (!t) return null;
  const h = Number(t.slice(0, 2));
  return Number.isFinite(h) ? h : null;
}

// yyyy-mm-dd -> day-of-week (0 Sun .. 6 Sat). Parsed locally so the user's
// timezone matches what they see on the date input.
function dowFromIsoDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y || 1970, (m || 1) - 1, d || 1);
  return dt.getDay();
}

// Pick start/end defaults for the given duration on a specific date based on
// what location_hours says about that day. Falls back to the legacy constants
// when no row exists (e.g. operator hasn't configured hours yet) or the row is
// marked closed (shouldn't happen via UI, but we don't crash on it).
function defaultsForDate(args: {
  durationType: string;
  startDateIso: string;
  endDateIso: string | null;
  hoursRows: LocationHoursRow[];
}): { startTime: string; endTime: string | null } {
  const startDow = dowFromIsoDate(args.startDateIso);
  const startHours = args.hoursRows.find((h) => h.day_of_week === startDow);
  const open = startHours && !startHours.closed ? clipTime(startHours.open_time) : null;
  const close = startHours && !startHours.closed ? clipTime(startHours.close_time) : null;

  if (args.durationType === "overnight" || args.durationType === "multi_night") {
    const endDow = args.endDateIso ? dowFromIsoDate(args.endDateIso) : startDow;
    const endHoursRow = args.hoursRows.find((h) => h.day_of_week === endDow);
    const endOpen =
      endHoursRow && !endHoursRow.closed ? clipTime(endHoursRow.open_time) : null;
    return {
      startTime: open ?? FALLBACK_START_OVERNIGHT,
      endTime: endOpen ?? FALLBACK_END_OVERNIGHT,
    };
  }
  if (args.durationType === "hourly") {
    return { startTime: open ?? FALLBACK_START_HOURLY, endTime: null };
  }
  if (args.durationType === "flat") {
    return { startTime: open ?? FALLBACK_START_DAY, endTime: null };
  }
  return {
    startTime: open ?? FALLBACK_START_DAY,
    endTime: close ?? FALLBACK_END_DAY,
  };
}

// Compute the time-picker range from the facility's location_hours. We take
// MIN(open) across open days and MAX(close) so all open days are reachable in
// one picker. When the facility has no configured hours we fall back to the
// legacy 6 AM - 9 PM range.
function pickerRangeFromHours(rows: LocationHoursRow[]): {
  startHour: number;
  endHour: number;
} {
  let minOpen: number | null = null;
  let maxClose: number | null = null;
  for (const r of rows) {
    if (r.closed) continue;
    const o = parseHour(r.open_time);
    const c = parseHour(r.close_time);
    if (o != null) minOpen = minOpen === null ? o : Math.min(minOpen, o);
    if (c != null) {
      // Round close up by an hour when there's a non-zero minute portion so
      // the picker still includes the closing time.
      const cm = Number(r.close_time?.slice(3, 5) ?? "0");
      const eff = cm > 0 ? c + 1 : c;
      maxClose = maxClose === null ? eff : Math.max(maxClose, eff);
    }
  }
  if (minOpen === null || maxClose === null || maxClose <= minOpen) {
    return { startHour: PICKER_FALLBACK_START_HOUR, endHour: PICKER_FALLBACK_END_HOUR };
  }
  return { startHour: minOpen, endHour: Math.min(maxClose, 23) };
}

export default function StepDateTime({
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
  const dur = state.service!.duration_type;
  const minDate = tomorrowISODate();

  // Pull facility hours so defaults reflect the actual open / close instead of
  // the legacy hardcoded values. Falls back to FALLBACK_* constants when no
  // location_hours row matches.
  const locationId = state.locationId ?? state.service?.location_id ?? null;
  const { data: hoursRows = [], isLoading: hoursLoading } = useQuery({
    queryKey: ["location-hours-defaults", locationId],
    enabled: !!locationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("location_hours")
        .select("day_of_week, open_time, close_time, closed")
        .eq("location_id", locationId!);
      if (error) throw error;
      return (data ?? []) as LocationHoursRow[];
    },
  });

  // 7.1 follow-up: groomer roster for grooming services. Empty for
  // non-grooming. Customers can pick a specific groomer or leave the
  // selection on "Any available" so staff can assign on confirmation.
  const isGrooming = state.service?.module === "grooming";
  const { data: groomers = [] } = useQuery({
    queryKey: ["wizard-groomers", state.service?.id],
    enabled: isGrooming,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("groomers")
        .select("id, display_name, working_days")
        .eq("status", "active")
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        display_name: string;
        working_days: string[] | null;
      }>;
    },
  });

  // 7.1 follow-up #2: when a specific groomer is picked, fetch the
  // dates they actually have availability windows for (next 60 days)
  // so the date picker only offers viable days. We also fetch the
  // available slots for the selected date so the time picker shows
  // exactly what's bookable, given service duration.
  //
  // For "Any available", we fall back to the facility-hours-based
  // generic time slot generator since we don't know who'd take the
  // booking.
  const groomerEndDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return d.toISOString().slice(0, 10);
  }, []);

  const { data: groomerDatesPayload } = useQuery({
    queryKey: ["wizard-groomer-dates", state.groomerId, minDate, groomerEndDate],
    enabled: isGrooming && !!state.groomerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_groomer_available_dates", {
        p_groomer_id: state.groomerId!,
        p_start_date: minDate,
        p_end_date: groomerEndDate,
      });
      if (error) throw error;
      return data as { dates?: string[] } | null;
    },
  });
  const groomerAvailableDates = groomerDatesPayload?.dates ?? [];

  const { data: groomerSlotsPayload, isLoading: slotsLoading } = useQuery({
    queryKey: [
      "wizard-groomer-slots",
      state.groomerId,
      state.datetime?.date,
      state.service?.estimated_minutes,
    ],
    enabled:
      isGrooming &&
      !!state.groomerId &&
      !!state.datetime?.date &&
      !!state.service?.estimated_minutes,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_groomer_available_slots", {
        p_groomer_id: state.groomerId!,
        p_date: state.datetime!.date,
        p_duration_minutes: state.service!.estimated_minutes!,
      });
      if (error) throw error;
      return data as { slots?: string[] } | null;
    },
  });
  const groomerSlots = groomerSlotsPayload?.slots ?? [];

  // Track whether the customer has manually overridden the default times.
  // We only auto-refresh defaults on date changes for users who haven't
  // edited the times yet — once they pick something themselves we respect
  // that across date changes.
  const userTouchedTimesRef = useRef(false);

  // Initialize sensible defaults once we know whether we have facility hours.
  // If the location is set we wait for the query so the visible default is
  // never the legacy 07:00/18:00 flashing into the real open/close.
  useEffect(() => {
    if (state.datetime) return;
    if (locationId && hoursLoading) return;

    const fmtDate = (x: Date) => {
      const p = (n: number) => String(n).padStart(2, "0");
      return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
    };

    const startDateObj = new Date();
    if (dur === "overnight" || dur === "multi_night") {
      startDateObj.setDate(startDateObj.getDate() + 1);
    } else {
      // For hourly, full-day, and flat the default date is "tomorrow"
      // via minDate; align startDateObj to it so day-of-week lookups
      // match the input value.
      const [y, m, d] = minDate.split("-").map(Number);
      startDateObj.setFullYear(y, m - 1, d);
    }
    const startDateIso = fmtDate(startDateObj);

    if (dur === "overnight" || dur === "multi_night") {
      const out = new Date(startDateObj);
      out.setDate(out.getDate() + (dur === "overnight" ? 1 : 2));
      const endDateIso = fmtDate(out);
      const d = defaultsForDate({
        durationType: dur,
        startDateIso,
        endDateIso,
        hoursRows,
      });
      setState((s) => ({
        ...s,
        datetime: {
          date: startDateIso,
          endDate: endDateIso,
          startTime: d.startTime,
          endTime: d.endTime ?? FALLBACK_END_OVERNIGHT,
        },
      }));
    } else if (dur === "hourly") {
      const d = defaultsForDate({
        durationType: "hourly",
        startDateIso: minDate,
        endDateIso: null,
        hoursRows,
      });
      setState((s) => ({
        ...s,
        datetime: { date: minDate, startTime: d.startTime, hours: 1 },
      }));
    } else if (dur === "flat") {
      // 7.1: Appointment services pick a single start time. The end
      // time is derived from service.estimated_minutes at submission.
      // No endTime / hours field shown to the customer.
      const d = defaultsForDate({
        durationType: "flat",
        startDateIso: minDate,
        endDateIso: null,
        hoursRows,
      });
      setState((s) => ({
        ...s,
        datetime: { date: minDate, startTime: d.startTime },
      }));
    } else {
      const d = defaultsForDate({
        durationType: dur,
        startDateIso: minDate,
        endDateIso: null,
        hoursRows,
      });
      setState((s) => ({
        ...s,
        datetime: {
          date: minDate,
          startTime: d.startTime,
          endTime: d.endTime ?? FALLBACK_END_DAY,
        },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoursLoading, hoursRows.length]);

  // When the customer changes the date(s) we re-derive the defaults so the
  // selected day-of-week's open/close times become the new starting point.
  // Skip if the customer has already chosen a time manually — that's a
  // deliberate override and shouldn't get clobbered by a date change.
  useEffect(() => {
    if (!state.datetime) return;
    if (locationId && hoursLoading) return;
    if (userTouchedTimesRef.current) return;
    if (hoursRows.length === 0) return;

    const d = defaultsForDate({
      durationType: dur,
      startDateIso: state.datetime.date,
      endDateIso: state.datetime.endDate ?? null,
      hoursRows,
    });
    setState((s) => {
      if (!s.datetime) return s;
      const next: typeof s.datetime = { ...s.datetime, startTime: d.startTime };
      // Only overwrite endTime when the duration carries one. For hourly /
      // flat the end is implicit so we leave the field alone.
      if (
        d.endTime !== null &&
        (dur === "half_day" ||
          dur === "full_day" ||
          dur === "overnight" ||
          dur === "multi_night")
      ) {
        next.endTime = d.endTime;
      }
      return { ...s, datetime: next };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.datetime?.date, state.datetime?.endDate, hoursRows.length, hoursLoading]);

  // Build the time-picker range from configured hours so customers can't
  // pick 4 AM at a 9-to-5 facility.
  const pickerRange = useMemo(() => pickerRangeFromHours(hoursRows), [hoursRows]);
  const pickerTimes = useMemo(
    () => generateTimeSlots(pickerRange.startHour, pickerRange.endHour),
    [pickerRange.startHour, pickerRange.endHour],
  );

  // Surface a "facility is closed" hint when the customer has selected a
  // closed day. Defaults already use the fallback hours in that case, but
  // showing the warning prevents a "why isn't it accepting my booking" loop.
  const closedDayWarning = useMemo(() => {
    if (!state.datetime?.date || hoursRows.length === 0) return null;
    const dow = dowFromIsoDate(state.datetime.date);
    const row = hoursRows.find((h) => h.day_of_week === dow);
    if (row?.closed) return "Facility is closed on this day.";
    return null;
  }, [state.datetime?.date, hoursRows]);

  const dt = state.datetime;
  const update = (patch: Partial<NonNullable<WizardState["datetime"]>>) => {
    // Any change that touches startTime or endTime is a deliberate user
    // edit, so we lock the auto-default behavior afterwards.
    if (patch.startTime !== undefined || patch.endTime !== undefined) {
      userTouchedTimesRef.current = true;
    }
    setState((s) => ({ ...s, datetime: { ...(s.datetime as any), ...patch } }));
  };

  const nights = dt?.endDate ? diffNights(dt.date, dt.endDate) : 0;
  const hours = dt?.hours ?? 1;

  const estimate = useMemo(() => {
    if (!state.service || !dt) return 0;
    return estimatePriceCents({
      basePriceCents: state.service.base_price_cents,
      durationType: dur,
      petCount: state.pets.length,
      nights,
      hours,
    });
  }, [state.service, dt, dur, state.pets.length, nights, hours]);

  // Validation
  const valid = (() => {
    if (!dt) return false;
    if (!dt.date) return false;
    if (dur === "overnight" || dur === "multi_night") {
      if (!dt.endDate) return false;
      if (nights < 1) return false;
    } else if (dur === "hourly" || dur === "flat") {
      // Flat services need only a start time. End is computed at
      // submission from service.estimated_minutes.
      if (!dt.startTime) return false;
      if (dur === "flat" && !state.service?.estimated_minutes) {
        // A flat service without a configured duration can't be booked.
        // Surface this clearly rather than silently failing.
        return false;
      }
    } else {
      if (!dt.startTime || !dt.endTime) return false;
      const start = combineDateTime(dt.date, dt.startTime);
      const end = combineDateTime(dt.date, dt.endTime);
      if (end <= start) return false;
    }
    return true;
  })();

  if (!dt) return null;

  const dayOfWeek = new Date(dt.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long" });

  return (
    <div className="space-y-4 py-2">
      {closedDayWarning && (
        <div className="rounded-lg border border-warning/30 bg-warning-light p-3 text-xs">
          {closedDayWarning} The default times below assume regular hours —
          please pick a different date or contact the facility before booking.
        </div>
      )}
      {(dur === "half_day" || dur === "full_day") && (
        <>
          <Field label={`Date (${dayOfWeek})`}>
            <Input type="date" min={minDate} value={dt.date} onChange={(e) => update({ date: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Drop-off time">
              <TimeSelect
                value={dt.startTime}
                onChange={(v) => update({ startTime: v })}
                times={pickerTimes}
              />
            </Field>
            <Field label="Pick-up time">
              <TimeSelect
                value={dt.endTime ?? ""}
                onChange={(v) => update({ endTime: v })}
                times={pickerTimes}
              />
            </Field>
          </div>
        </>
      )}

      {(dur === "overnight" || dur === "multi_night") && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in date">
              <Input type="date" min={minDate} value={dt.date} onChange={(e) => update({ date: e.target.value })} />
            </Field>
            <Field label="Check-out date">
              <Input
                type="date"
                min={dt.date || minDate}
                value={dt.endDate ?? ""}
                onChange={(e) => update({ endDate: e.target.value })}
              />
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">
            {nights} night{nights === 1 ? "" : "s"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in time">
              <TimeSelect
                value={dt.startTime}
                onChange={(v) => update({ startTime: v })}
                times={pickerTimes}
              />
            </Field>
            <Field label="Check-out time">
              <TimeSelect
                value={dt.endTime ?? ""}
                onChange={(v) => update({ endTime: v })}
                times={pickerTimes}
              />
            </Field>
          </div>
        </>
      )}

      {dur === "hourly" && (
        <>
          <Field label={`Date (${dayOfWeek})`}>
            <Input type="date" min={minDate} value={dt.date} onChange={(e) => update({ date: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start time">
              <TimeSelect
                value={dt.startTime}
                onChange={(v) => update({ startTime: v })}
                times={pickerTimes}
              />
            </Field>
            <Field label="Duration">
              <Select value={String(hours)} onValueChange={(v) => update({ hours: Number(v) })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h} hour{h === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </>
      )}

      {dur === "flat" && (
        <>
          {/* 7.1 follow-up: groomer first so a customer who prefers a
              specific person sees only their availability. */}
          {isGrooming && groomers.length > 0 && (
            <Field label="Groomer">
              <Select
                value={state.groomerId ?? "__any__"}
                onValueChange={(v) =>
                  setState((s) => ({
                    ...s,
                    groomerId: v === "__any__" ? null : v,
                    // Reset the time when the groomer changes — the
                    // previously-picked slot may not be valid for the
                    // new groomer's availability.
                    datetime: s.datetime ? { ...s.datetime, startTime: "" } : s.datetime,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any available groomer</SelectItem>
                  {groomers.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {groomers.length} groomer{groomers.length === 1 ? "" : "s"} on
                staff. Pick one to see only their available dates and times,
                or leave on "Any available" to see facility-wide options.
              </p>
            </Field>
          )}
          {isGrooming && groomers.length === 0 && (
            <p className="text-xs text-muted-foreground">
              The facility will assign a groomer when they confirm your booking.
            </p>
          )}

          {/* When a specific groomer is picked, show a month calendar
              with non-available days disabled. Otherwise fall back to
              a free-form date input. The calendar UX makes it obvious
              which days the groomer is open vs not, and lets the
              customer skim weeks rather than scroll a long dropdown. */}
          {isGrooming && state.groomerId && groomerAvailableDates.length > 0 ? (
            <Field label="Date">
              <GroomerDatePicker
                value={dt.date}
                onChange={(v) => update({ date: v })}
                availableDates={groomerAvailableDates}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {groomerAvailableDates.length} day
                {groomerAvailableDates.length === 1 ? "" : "s"} available in
                the next 60 days. Greyed-out days are blocked off.
              </p>
            </Field>
          ) : isGrooming && state.groomerId && groomerAvailableDates.length === 0 ? (
            <p className="rounded-lg border border-warning/30 bg-warning-light p-3 text-xs">
              This groomer has no availability in the next 60 days. Pick "Any
              available" or a different groomer.
            </p>
          ) : (
            <Field label={`Date (${dayOfWeek})`}>
              <Input
                type="date"
                min={minDate}
                value={dt.date}
                onChange={(e) => update({ date: e.target.value })}
              />
            </Field>
          )}

          {/* When a specific groomer is picked AND a date is set,
              show only their available slots for the requested
              service duration. Otherwise the generic facility-hours
              picker. */}
          {isGrooming && state.groomerId && groomerAvailableDates.length > 0 ? (
            slotsLoading ? (
              <p className="text-xs text-muted-foreground">Loading slots…</p>
            ) : groomerSlots.length === 0 ? (
              <p className="rounded-lg border border-warning/30 bg-warning-light p-3 text-xs">
                No open slots on the selected day for a{" "}
                {state.service?.estimated_minutes ?? 60}-minute appointment.
                Pick another date.
              </p>
            ) : (
              <Field label="Appointment time">
                <Select
                  value={dt.startTime}
                  onValueChange={(v) => update({ startTime: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a time" />
                  </SelectTrigger>
                  <SelectContent>
                    {groomerSlots.map((t) => {
                      const [h, m] = t.split(":").map(Number);
                      const period = h < 12 ? "AM" : "PM";
                      const display = h % 12 === 0 ? 12 : h % 12;
                      return (
                        <SelectItem key={t} value={t}>
                          {display}:{String(m).padStart(2, "0")} {period}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </Field>
            )
          ) : (
            <Field label="Appointment time">
              <TimeSelect
                value={dt.startTime}
                onChange={(v) => update({ startTime: v })}
                times={pickerTimes}
              />
            </Field>
          )}

          {state.service?.estimated_minutes ? (
            <p className="text-xs text-muted-foreground">
              Approximate duration: {state.service.estimated_minutes} minute
              {state.service.estimated_minutes === 1 ? "" : "s"}
            </p>
          ) : (
            <p className="text-xs text-destructive">
              This service has no configured duration. Contact the facility to
              set one before booking.
            </p>
          )}
        </>
      )}

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
        <Button disabled={!valid} onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function TimeSelect({
  value,
  onChange,
  times,
}: {
  value: string;
  onChange: (v: string) => void;
  times: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select time" />
      </SelectTrigger>
      <SelectContent className="max-h-60">
        {times.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Month calendar picker. Disables every day NOT in availableDates so
// the customer can only land on a day the groomer is open. Renders
// inside a Popover so it stays compact in the wizard.
function GroomerDatePicker({
  value,
  onChange,
  availableDates,
}: {
  value: string;
  onChange: (next: string) => void;
  availableDates: string[];
}) {
  const [open, setOpen] = useState(false);
  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);

  // The first available date is a useful default and the lower bound
  // for the calendar's view. Without it the calendar opens on today
  // and the user has to scan ahead to find the first open day.
  const firstAvailable = availableDates[0];
  const lastAvailable = availableDates[availableDates.length - 1];

  const selected = value ? new Date(value + "T00:00:00") : undefined;
  const buttonLabel = selected
    ? selected.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Pick a date";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !selected && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {buttonLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? (firstAvailable ? new Date(firstAvailable + "T00:00:00") : undefined)}
          fromDate={firstAvailable ? new Date(firstAvailable + "T00:00:00") : undefined}
          toDate={lastAvailable ? new Date(lastAvailable + "T00:00:00") : undefined}
          // Disable any day not in the available set so the customer
          // can't pick a closed day. react-day-picker calls this for
          // each rendered cell.
          disabled={(date) => {
            const ymd = date.toISOString().slice(0, 10);
            return !availableSet.has(ymd);
          }}
          onSelect={(d) => {
            if (!d) return;
            // Normalize to local yyyy-mm-dd to match the rest of the
            // wizard's string-based date plumbing.
            const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            onChange(ymd);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
