import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatCentsShort } from "@/lib/money";
import {
  combineDateTime,
  diffNights,
  estimatePriceCents,
  generateTimeSlots,
  tomorrowISODate,
} from "@/lib/booking";
import type { WizardState } from "./BookingWizard";

// Hardcoded fallbacks used when the facility has no configured hours for the
// initial date. Kept aligned with the prior pre-Cluster-4 behavior so an
// operator that has not set up location_hours sees no regression.
const FALLBACK_START_DAY = "07:00";
const FALLBACK_END_DAY = "18:00";
const FALLBACK_START_OVERNIGHT = "14:00";
const FALLBACK_END_OVERNIGHT = "11:00";
const FALLBACK_START_HOURLY = "09:00";

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

const TIMES = generateTimeSlots(6, 21);

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
      // For hourly and full-day, default date is "tomorrow" via minDate; align
      // startDateObj to it so day-of-week lookups match the input value.
      const [y, m, d] = minDate.split("-").map(Number);
      startDateObj.setFullYear(y, m - 1, d);
    }
    const startDow = startDateObj.getDay();
    const startHours = hoursRows.find((h) => h.day_of_week === startDow);
    const facilityOpen = startHours && !startHours.closed ? clipTime(startHours.open_time) : null;
    const facilityClose = startHours && !startHours.closed ? clipTime(startHours.close_time) : null;

    if (dur === "overnight" || dur === "multi_night") {
      const out = new Date(startDateObj);
      out.setDate(out.getDate() + (dur === "overnight" ? 1 : 2));
      const outDow = out.getDay();
      const outHours = hoursRows.find((h) => h.day_of_week === outDow);
      const pickupOpen = outHours && !outHours.closed ? clipTime(outHours.open_time) : null;
      setState((s) => ({
        ...s,
        datetime: {
          date: fmtDate(startDateObj),
          endDate: fmtDate(out),
          startTime: facilityOpen ?? FALLBACK_START_OVERNIGHT,
          endTime: pickupOpen ?? FALLBACK_END_OVERNIGHT,
        },
      }));
    } else if (dur === "hourly") {
      setState((s) => ({
        ...s,
        datetime: {
          date: minDate,
          startTime: facilityOpen ?? FALLBACK_START_HOURLY,
          hours: 1,
        },
      }));
    } else {
      setState((s) => ({
        ...s,
        datetime: {
          date: minDate,
          startTime: facilityOpen ?? FALLBACK_START_DAY,
          endTime: facilityClose ?? FALLBACK_END_DAY,
        },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoursLoading, hoursRows.length]);

  const dt = state.datetime;
  const update = (patch: Partial<NonNullable<WizardState["datetime"]>>) =>
    setState((s) => ({ ...s, datetime: { ...(s.datetime as any), ...patch } }));

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
    } else if (dur === "hourly") {
      if (!dt.startTime) return false;
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
      {(dur === "half_day" || dur === "full_day") && (
        <>
          <Field label={`Date (${dayOfWeek})`}>
            <Input type="date" min={minDate} value={dt.date} onChange={(e) => update({ date: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Drop-off time">
              <TimeSelect value={dt.startTime} onChange={(v) => update({ startTime: v })} />
            </Field>
            <Field label="Pick-up time">
              <TimeSelect value={dt.endTime ?? ""} onChange={(v) => update({ endTime: v })} />
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
              <TimeSelect value={dt.startTime} onChange={(v) => update({ startTime: v })} />
            </Field>
            <Field label="Check-out time">
              <TimeSelect value={dt.endTime ?? ""} onChange={(v) => update({ endTime: v })} />
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
              <TimeSelect value={dt.startTime} onChange={(v) => update({ startTime: v })} />
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

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select time" />
      </SelectTrigger>
      <SelectContent className="max-h-60">
        {TIMES.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
