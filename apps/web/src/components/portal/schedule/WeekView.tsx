import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // make Monday=0
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function WeekView({
  selectedDate,
  onPickDay,
  moduleFilter,
}: {
  selectedDate: Date;
  onPickDay: (d: Date) => void;
  moduleFilter: "all" | "daycare" | "boarding";
}) {
  const start = startOfWeek(selectedDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const { data } = useQuery({
    queryKey: ["schedule-week", ymd(start), moduleFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("id, start_at, services!inner(module)")
        .is("deleted_at", null)
        .gte("start_at", start.toISOString())
        .lt("start_at", end.toISOString())
        .neq("status", "cancelled");
      if (error) throw error;
      return data ?? [];
    },
  });

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });

  const counts = days.map((day) => {
    const key = ymd(day);
    const filt = (data ?? []).filter((r: any) => {
      const dKey = ymd(new Date(r.start_at));
      if (dKey !== key) return false;
      if (moduleFilter === "all") return true;
      return r.services?.module === moduleFilter;
    });
    return {
      daycare: filt.filter((r: any) => r.services?.module === "daycare").length,
      boarding: filt.filter((r: any) => r.services?.module === "boarding").length,
    };
  });

  const todayKey = ymd(new Date());
  const selKey = ymd(selectedDate);

  return (
    <div className="grid grid-cols-7 gap-3">
      {days.map((d, i) => {
        const k = ymd(d);
        const isToday = k === todayKey;
        const isSelected = k === selKey;
        const c = counts[i];
        return (
          <button
            key={k}
            onClick={() => onPickDay(d)}
            className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition shadow-card ${
              isSelected
                ? "border-primary bg-primary-light"
                : "border-border bg-card hover:bg-background"
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="label-eyebrow">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
              <span
                className={`font-display text-xl font-bold ${
                  isToday ? "text-primary" : "text-foreground"
                }`}
              >
                {d.getDate()}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              {c.daycare > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  {c.daycare}
                </span>
              )}
              {c.boarding > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-plum" />
                  {c.boarding}
                </span>
              )}
              {c.daycare === 0 && c.boarding === 0 && (
                <span className="text-text-tertiary">—</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
