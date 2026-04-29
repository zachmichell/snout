import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useLocationFilter } from "@/contexts/LocationContext";

type ViewMode = "week" | "month";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // Monday=0
  x.setDate(x.getDate() - diff);
  return x;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

type ResRow = {
  start_at: string;
  services: { module: string | null } | null;
};

export default function Schedule() {
  const navigate = useNavigate();
  const locationId = useLocationFilter();
  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

  const range = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(anchor);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
    // Month view: include leading/trailing days to fill 6-row grid
    const monthStart = startOfMonth(anchor);
    const start = startOfWeek(monthStart);
    const end = new Date(start);
    end.setDate(end.getDate() + 42);
    return { start, end };
  }, [view, anchor]);

  const { data: rows = [] } = useQuery({
    queryKey: ["calendar-range", view, ymd(range.start), ymd(range.end), locationId],
    queryFn: async () => {
      let q = supabase
        .from("reservations")
        .select("start_at, services!inner(module)")
        .is("deleted_at", null)
        .neq("status", "cancelled")
        .gte("start_at", range.start.toISOString())
        .lt("start_at", range.end.toISOString());
      if (locationId) q = q.eq("location_id", locationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ResRow[];
    },
  });

  // Bucket counts per day
  const buckets = useMemo(() => {
    const map = new Map<string, { total: number; daycare: number; boarding: number; grooming: number }>();
    for (const r of rows) {
      const k = ymd(new Date(r.start_at));
      const cur = map.get(k) ?? { total: 0, daycare: 0, boarding: 0, grooming: 0 };
      cur.total++;
      const m = r.services?.module;
      if (m === "daycare") cur.daycare++;
      else if (m === "boarding") cur.boarding++;
      else if (m === "grooming") cur.grooming++;
      map.set(k, cur);
    }
    return map;
  }, [rows]);

  const goPrev = () => {
    const d = new Date(anchor);
    if (view === "week") d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setAnchor(startOfDay(d));
  };
  const goNext = () => {
    const d = new Date(anchor);
    if (view === "week") d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setAnchor(startOfDay(d));
  };
  const goToday = () => setAnchor(startOfDay(new Date()));

  const headerLabel = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(anchor);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const sameMonth = start.getMonth() === end.getMonth();
      const startStr = start.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const endStr = end.toLocaleDateString(undefined, {
        month: sameMonth ? undefined : "short",
        day: "numeric",
        year: "numeric",
      });
      return `${startStr} – ${endStr}`;
    }
    return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [view, anchor]);

  const onPickDay = (d: Date) => {
    // Navigate to dashboard. (Dashboard is today-focused; ?date= reserved for future.)
    navigate(`/dashboard?date=${ymd(d)}`);
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={goPrev} aria-label="Previous">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={goNext} aria-label="Next">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToday}>
                Today
              </Button>
            </div>
            <h1 className="mt-3 font-display text-2xl text-foreground">{headerLabel}</h1>
          </div>

          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            <button
              onClick={() => setView("week")}
              className={`rounded-sm px-3 py-1.5 text-xs font-semibold transition ${
                view === "week" ? "bg-primary text-primary-foreground" : "text-text-secondary"
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView("month")}
              className={`rounded-sm px-3 py-1.5 text-xs font-semibold transition ${
                view === "month" ? "bg-primary text-primary-foreground" : "text-text-secondary"
              }`}
            >
              Month
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-success" /> Daycare
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-teal" /> Boarding
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-brand-cotton" /> Grooming
          </span>
        </div>

        {view === "week" ? (
          <WeekGrid start={startOfWeek(anchor)} buckets={buckets} onPickDay={onPickDay} />
        ) : (
          <MonthGrid anchor={anchor} buckets={buckets} onPickDay={onPickDay} />
        )}
      </div>
    </PortalLayout>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function WeekGrid({
  start,
  buckets,
  onPickDay,
}: {
  start: Date;
  buckets: Map<string, { total: number; daycare: number; boarding: number; grooming: number }>;
  onPickDay: (d: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
  const todayKey = ymd(new Date());

  return (
    <div className="grid grid-cols-7 gap-3">
      {days.map((d) => {
        const k = ymd(d);
        const b = buckets.get(k);
        const isToday = k === todayKey;
        return (
          <button
            key={k}
            onClick={() => onPickDay(d)}
            className={`flex min-h-[140px] flex-col items-stretch gap-3 rounded-lg border p-4 text-left shadow-card transition hover:bg-background ${
              isToday ? "border-primary bg-primary-light" : "border-border bg-card"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="label-eyebrow">{WEEKDAYS[(d.getDay() + 6) % 7]}</span>
              <span
                className={`font-display text-2xl font-bold ${
                  isToday ? "text-primary" : "text-foreground"
                }`}
              >
                {d.getDate()}
              </span>
            </div>
            <div className="mt-auto space-y-2">
              <div className="font-display text-xl font-bold text-foreground">{b?.total ?? 0}</div>
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                {b?.daycare ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    {b.daycare}
                  </span>
                ) : null}
                {b?.boarding ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-teal" />
                    {b.boarding}
                  </span>
                ) : null}
                {b?.grooming ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-brand-cotton" />
                    {b.grooming}
                  </span>
                ) : null}
                {!b?.total && <span className="text-text-tertiary">—</span>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MonthGrid({
  anchor,
  buckets,
  onPickDay,
}: {
  anchor: Date;
  buckets: Map<string, { total: number; daycare: number; boarding: number; grooming: number }>;
  onPickDay: (d: Date) => void;
}) {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const todayKey = ymd(new Date());

  // Determine max for color intensity scaling
  const max = Math.max(1, ...Array.from(buckets.values()).map((b) => b.total));

  const intensity = (n: number) => {
    if (n <= 0) return "bg-card";
    const ratio = n / max;
    if (ratio < 0.25) return "bg-brand-vanilla-bg";
    if (ratio < 0.5) return "bg-brand-cotton-bg";
    if (ratio < 0.75) return "bg-brand-mist-bg";
    return "bg-primary-light";
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      <div className="grid grid-cols-7 border-b border-border-subtle bg-background">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-text-secondary"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const k = ymd(d);
          const b = buckets.get(k);
          const inMonth = d >= monthStart && d <= monthEnd;
          const isToday = k === todayKey;
          const total = b?.total ?? 0;
          return (
            <button
              key={k + i}
              onClick={() => onPickDay(d)}
              className={`flex min-h-[88px] flex-col items-start gap-1 border-b border-r border-border-subtle p-2 text-left transition hover:bg-background ${intensity(total)} ${
                inMonth ? "" : "opacity-40"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span
                  className={`text-xs font-semibold ${
                    isToday
                      ? "rounded-full bg-primary px-1.5 py-0.5 text-primary-foreground"
                      : "text-foreground"
                  }`}
                >
                  {d.getDate()}
                </span>
              </div>
              {total > 0 && (
                <div className="mt-auto font-display text-lg font-bold text-foreground">{total}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
