import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import StatusBadge from "@/components/portal/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, BedDouble, ArrowRightLeft } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSuites, type SuiteRow } from "@/hooks/useSuites";
import { cn } from "@/lib/utils";
import { useLocationFilter } from "@/contexts/LocationContext";
import { toast } from "sonner";

type ViewMode = "weekly" | "monthly";
type VacancyFilter = "all" | "vacant" | "occupied";

type ResvRow = {
  id: string;
  status: string;
  start_at: string;
  end_at: string;
  suite_id: string | null;
  service_id: string | null;
  reservation_pets: { pets: { id: string; name: string } | null }[];
};

type DragPayload = {
  reservationId: string;
  fromSuiteId: string;
  startKey: string; // yyyy-MM-dd
  endKey: string;   // yyyy-MM-dd
};

const TYPE_TONES: Record<SuiteRow["type"], "muted" | "primary" | "plum"> = {
  standard: "muted",
  deluxe: "primary",
  presidential: "plum",
};

function occupancyHeaderClass(pct: number) {
  if (pct > 90) return "bg-danger-light text-danger";
  if (pct >= 70) return "bg-warning-light text-warning";
  return "bg-success-light text-success";
}

export default function Lodging() {
  const navigate = useNavigate();
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const locationId = useLocationFilter();
  const qc = useQueryClient();

  const [view, setView] = useState<ViewMode>("weekly");
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
  const [vacancyFilter, setVacancyFilter] = useState<VacancyFilter>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");

  const allSuites = useSuites({ activeOnly: false });
  const allSuitesScoped = (allSuites.data ?? []).filter(
    (s: any) => !locationId || s.location_id === locationId,
  );
  const suitesLoading = allSuites.isLoading;

  const { rangeStart, rangeEnd, days } = useMemo(() => {
    if (view === "weekly") {
      const start = startOfWeek(anchor, { weekStartsOn: 1 });
      const end = endOfWeek(anchor, { weekStartsOn: 1 });
      const ds: Date[] = [];
      for (let d = start; d <= end; d = addDays(d, 1)) ds.push(d);
      return { rangeStart: start, rangeEnd: end, days: ds };
    }
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    const ds: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) ds.push(d);
    return { rangeStart: start, rangeEnd: end, days: ds };
  }, [view, anchor]);

  const { data: services = [] } = useQuery({
    queryKey: ["lodging-services", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const { data: reservations = [] } = useQuery({
    queryKey: [
      "lodging-reservations",
      orgId,
      rangeStart.toISOString(),
      rangeEnd.toISOString(),
      locationId,
    ],
    enabled: !!orgId,
    queryFn: async () => {
      const startIso = rangeStart.toISOString();
      const endIso = addDays(rangeEnd, 1).toISOString();
      let q = supabase
        .from("reservations")
        .select("id, status, start_at, end_at, suite_id, service_id, reservation_pets(pets(id, name))")
        .eq("organization_id", orgId!)
        .not("suite_id", "is", null)
        .in("status", ["confirmed", "checked_in", "requested"])
        .is("deleted_at", null)
        .lt("start_at", endIso)
        .gte("end_at", startIso);
      if (locationId) q = q.eq("location_id", locationId);
      const { data, error } = await q;
      if (error) throw error;
      // Supabase's generated type narrows the joined pets row to a single
      // object, but PostgREST returns the array shape that ResvRow models.
      // Cast through unknown so the structural mismatch in the generated
      // types doesn't trip the typechecker on what is actually correct
      // runtime data.
      return (data ?? []) as unknown as ResvRow[];
    },
  });

  // Apply service filter to reservations
  const filteredReservations = useMemo(() => {
    if (serviceFilter === "all") return reservations;
    return reservations.filter((r) => r.service_id === serviceFilter);
  }, [reservations, serviceFilter]);

  // Cell lookup: suiteId|YYYY-MM-DD -> reservation
  const cellMap = useMemo(() => {
    const m = new Map<string, ResvRow>();
    for (const r of filteredReservations) {
      if (!r.suite_id) continue;
      const start = startOfDay(new Date(r.start_at));
      const end = startOfDay(new Date(r.end_at));
      for (let d = start; d <= end; d = addDays(d, 1)) {
        m.set(`${r.suite_id}|${format(d, "yyyy-MM-dd")}`, r);
      }
    }
    return m;
  }, [filteredReservations]);

  // Per-day occupancy across visible suites (for column headers)
  const dayOccupancy = useMemo(() => {
    const map = new Map<string, { occupied: number; total: number; pct: number }>();
    const total = allSuitesScoped.filter((s) => s.status === "active").length;
    for (const d of days) {
      const key = format(d, "yyyy-MM-dd");
      let occ = 0;
      for (const s of allSuitesScoped) {
        if (cellMap.has(`${s.id}|${key}`)) occ++;
      }
      const pct = total > 0 ? Math.round((occ / total) * 100) : 0;
      map.set(key, { occupied: occ, total, pct });
    }
    return map;
  }, [allSuitesScoped, days, cellMap]);

  // Vacancy filter: hide suites that don't match within range
  const suites = useMemo(() => {
    if (vacancyFilter === "all") return allSuitesScoped;
    return allSuitesScoped.filter((s) => {
      const hasAny = days.some((d) => cellMap.has(`${s.id}|${format(d, "yyyy-MM-dd")}`));
      return vacancyFilter === "occupied" ? hasAny : !hasAny;
    });
  }, [allSuitesScoped, vacancyFilter, days, cellMap]);

  // Pet transfers
  const transferStartKeys = useMemo(() => {
    const set = new Set<string>();
    const byPet = new Map<string, Map<string, string>>();
    for (const r of filteredReservations) {
      if (!r.suite_id) continue;
      const petId = r.reservation_pets?.[0]?.pets?.id;
      if (!petId) continue;
      const start = startOfDay(new Date(r.start_at));
      const end = startOfDay(new Date(r.end_at));
      let perDay = byPet.get(petId);
      if (!perDay) {
        perDay = new Map();
        byPet.set(petId, perDay);
      }
      for (let d = start; d <= end; d = addDays(d, 1)) {
        perDay.set(format(d, "yyyy-MM-dd"), r.suite_id);
      }
    }
    for (const [, perDay] of byPet) {
      const sorted = Array.from(perDay.entries()).sort(([a], [b]) => a.localeCompare(b));
      let prevSuite: string | null = null;
      let prevDate: Date | null = null;
      for (const [dayKey, suiteId] of sorted) {
        const dt = new Date(dayKey);
        if (
          prevSuite &&
          prevSuite !== suiteId &&
          prevDate &&
          Math.round((dt.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)) <= 1
        ) {
          set.add(`${suiteId}|${dayKey}`);
        }
        prevSuite = suiteId;
        prevDate = dt;
      }
    }
    return set;
  }, [filteredReservations]);

  // Stats
  const today = startOfDay(new Date());
  const occupiedToday = useMemo(() => {
    const set = new Set<string>();
    const key = format(today, "yyyy-MM-dd");
    for (const s of allSuitesScoped) {
      if (cellMap.has(`${s.id}|${key}`)) set.add(s.id);
    }
    return set.size;
  }, [cellMap, allSuitesScoped, today]);
  const totalActive = allSuitesScoped.filter((s) => s.status === "active").length;
  const available = Math.max(0, totalActive - occupiedToday);
  const occupancyPct = totalActive > 0 ? Math.round((occupiedToday / totalActive) * 100) : 0;

  const goPrev = () => setAnchor(view === "weekly" ? subDays(anchor, 7) : subMonths(anchor, 1));
  const goNext = () => setAnchor(view === "weekly" ? addDays(anchor, 7) : addMonths(anchor, 1));
  const goToday = () => setAnchor(startOfDay(new Date()));

  const petName = (r: ResvRow) =>
    r.reservation_pets?.[0]?.pets?.name ?? "Guest";

  const handleEmptyCell = (suiteId: string, day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd'T'09:00");
    navigate(`/reservations/new?suite_id=${suiteId}&start=${encodeURIComponent(dateStr)}`);
  };

  // Drag & drop: move reservation to a new suite
  const handleDropOnSuite = async (
    payload: DragPayload,
    targetSuite: SuiteRow,
  ) => {
    if (payload.fromSuiteId === targetSuite.id) return;

    // Capacity check across the stay's days
    const stayDays: string[] = [];
    let d = startOfDay(new Date(payload.startKey));
    const end = startOfDay(new Date(payload.endKey));
    for (; d <= end; d = addDays(d, 1)) stayDays.push(format(d, "yyyy-MM-dd"));

    // Count any other reservation already on those days in target suite
    const conflict = stayDays.some((k) => {
      const existing = cellMap.get(`${targetSuite.id}|${k}`);
      return existing && existing.id !== payload.reservationId;
    });
    if (conflict && targetSuite.capacity <= 1) {
      toast.error(`${targetSuite.name} is unavailable for those dates`);
      return;
    }

    const fromSuite = allSuitesScoped.find((s) => s.id === payload.fromSuiteId);
    const { error } = await supabase
      .from("reservations")
      .update({ suite_id: targetSuite.id })
      .eq("id", payload.reservationId);

    if (error) {
      toast.error(`Move failed: ${error.message}`);
      return;
    }

    const movedPet = filteredReservations.find((r) => r.id === payload.reservationId);
    toast.success(
      `Moved ${movedPet ? petName(movedPet) : "pet"} from ${fromSuite?.name ?? "suite"} to ${targetSuite.name}`,
    );
    qc.invalidateQueries({ queryKey: ["lodging-reservations"] });
  };

  const rangeLabel =
    view === "weekly"
      ? `${format(rangeStart, "MMM d")} – ${format(rangeEnd, "MMM d, yyyy")}`
      : format(anchor, "MMMM yyyy");

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Lodging"
          description="Suite occupancy at a glance"
          actions={
            <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
              <TabsList>
                <TabsTrigger value="weekly">Weekly</TabsTrigger>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />

        {/* Stats bar */}
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total suites" value={totalActive} accent="bg-brand-cottoncandy" />
          <StatCard label="Occupied today" value={occupiedToday} accent="bg-brand-vanilla" />
          <StatCard label="Available" value={available} accent="bg-brand-mist" />
          <StatCard label="Occupancy" value={`${occupancyPct}%`} accent="bg-brand-frost" />
        </div>

        {/* Date nav + filters */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goPrev} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={goNext} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="ml-3 font-display text-lg text-foreground">{rangeLabel}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={vacancyFilter} onValueChange={(v) => setVacancyFilter(v as VacancyFilter)}>
              <SelectTrigger className="h-9 w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suites</SelectItem>
                <SelectItem value="vacant">Show only vacant</SelectItem>
                <SelectItem value="occupied">Show only occupied</SelectItem>
              </SelectContent>
            </Select>
            <Select value={serviceFilter} onValueChange={setServiceFilter}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="Reservation type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All reservation types</SelectItem>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {suitesLoading ? (
          <div className="h-64 animate-pulse rounded-lg bg-surface" />
        ) : allSuitesScoped.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-12 text-center shadow-card">
            <BedDouble className="mx-auto h-10 w-10 text-text-tertiary" />
            <div className="mt-3 font-display text-lg">No suites yet</div>
            <p className="mt-1 text-sm text-text-secondary">
              Add suites in Suite Management to start tracking occupancy.
            </p>
            <Button className="mt-4" onClick={() => navigate("/suite-management")}>
              Manage suites
            </Button>
          </div>
        ) : suites.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-12 text-center shadow-card">
            <div className="font-display text-lg">No suites match the current filters</div>
            <p className="mt-1 text-sm text-text-secondary">Try clearing the vacancy or type filter.</p>
          </div>
        ) : (
          <>
            {/* Desktop grid */}
            <Card className="hidden overflow-x-auto border-border bg-card md:block">
              {view === "weekly" ? (
                <WeeklyGrid
                  suites={suites}
                  days={days}
                  cellMap={cellMap}
                  dayOccupancy={dayOccupancy}
                  transferStartKeys={transferStartKeys}
                  petName={petName}
                  onEmptyClick={handleEmptyCell}
                  onOccupiedClick={(r) => navigate(`/reservations/${r.id}`)}
                  onDropOnSuite={handleDropOnSuite}
                />
              ) : (
                <MonthlyGrid
                  suites={suites}
                  days={days}
                  cellMap={cellMap}
                  dayOccupancy={dayOccupancy}
                  reservations={filteredReservations}
                  petName={petName}
                  rangeStart={rangeStart}
                  rangeEnd={rangeEnd}
                  onCellClick={(suiteId, day) => {
                    const r = cellMap.get(`${suiteId}|${format(day, "yyyy-MM-dd")}`);
                    if (r) navigate(`/reservations/${r.id}`);
                    else handleEmptyCell(suiteId, day);
                  }}
                  onDropOnSuite={handleDropOnSuite}
                />
              )}
            </Card>

            {/* Mobile stacked */}
            <div className="space-y-3 md:hidden">
              {suites.map((s) => (
                <Card key={s.id} className="border-border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="font-display text-base text-foreground">{s.name}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusBadge tone={TYPE_TONES[s.type]}>
                          {s.type.charAt(0).toUpperCase() + s.type.slice(1)}
                        </StatusBadge>
                        <span className="text-xs text-text-secondary">
                          {s.capacity} {s.capacity === 1 ? "pet" : "pets"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {days.slice(0, 7).map((d) => {
                      const r = cellMap.get(`${s.id}|${format(d, "yyyy-MM-dd")}`);
                      return (
                        <button
                          key={d.toISOString()}
                          onClick={() => (r ? navigate(`/reservations/${r.id}`) : handleEmptyCell(s.id, d))}
                          className={cn(
                            "flex min-h-[48px] flex-col items-center justify-center rounded-md border text-[10px] transition-colors",
                            r
                              ? r.status === "checked_in"
                                ? "border-success/30 bg-success-light text-success"
                                : "border-primary/30 bg-primary-light text-primary"
                              : "border-border bg-background text-text-tertiary hover:bg-surface",
                          )}
                        >
                          <span className="font-semibold">{format(d, "EEEEE")}</span>
                          <span>{format(d, "d")}</span>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* Legend */}
        <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-text-secondary">
          <LegendDot className="bg-success" label="Checked in" />
          <LegendDot className="bg-primary" label="Reserved" />
          <LegendDot className="bg-border" label="Available" />
          <span className="inline-flex items-center gap-1.5">
            <ArrowRightLeft className="h-3 w-3" /> Transfer between suites
          </span>
          <span className="text-text-tertiary">· Drag a pet between suite rows to reassign</span>
        </div>
      </div>
    </PortalLayout>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <Card className="overflow-hidden border-border bg-card">
      <div className={cn("h-1.5 w-full", accent)} />
      <div className="p-4">
        <div className="label-eyebrow">{label}</div>
        <div className="mt-1 font-display text-2xl text-foreground">{value}</div>
      </div>
    </Card>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} />
      {label}
    </span>
  );
}

function SuiteRowHeader({ s }: { s: SuiteRow }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-medium text-foreground">{s.name}</div>
      <div className="flex items-center gap-2">
        <StatusBadge tone={TYPE_TONES[s.type]}>
          {s.type.charAt(0).toUpperCase() + s.type.slice(1)}
        </StatusBadge>
        <span className="text-[11px] text-text-tertiary">
          {s.capacity} {s.capacity === 1 ? "pet" : "pets"}
        </span>
      </div>
    </div>
  );
}

function DayHeader({
  day,
  occ,
  compact = false,
  isToday,
}: {
  day: Date;
  occ?: { occupied: number; total: number; pct: number };
  compact?: boolean;
  isToday: boolean;
}) {
  const tone = occ ? occupancyHeaderClass(occ.pct) : "";
  return (
    <div
      className={cn(
        "border-l border-border-subtle text-center",
        compact ? "py-1.5" : "py-2",
        isToday && "ring-1 ring-inset ring-primary/40",
        tone,
      )}
    >
      {compact ? (
        <>
          <div className="text-[10px] font-semibold">{format(day, "d")}</div>
          <div className="text-[9px] opacity-80">{format(day, "EEEEE")}</div>
          {occ && occ.total > 0 && (
            <div className="mt-0.5 text-[9px] font-semibold">{occ.pct}%</div>
          )}
        </>
      ) : (
        <>
          <div className="text-xs font-semibold uppercase">{format(day, "EEE")}</div>
          <div className="text-[11px] opacity-80">{format(day, "MMM d")}</div>
          {occ && occ.total > 0 && (
            <div className="mt-1 text-[10px] font-semibold">
              {occ.pct}% · {occ.occupied}/{occ.total}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const DRAG_MIME = "application/x-snout-resv";

function readDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
    if (!raw) return null;
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

function writeDragPayload(e: React.DragEvent, payload: DragPayload) {
  const json = JSON.stringify(payload);
  e.dataTransfer.setData(DRAG_MIME, json);
  e.dataTransfer.setData("text/plain", json);
  e.dataTransfer.effectAllowed = "move";
}

function WeeklyGrid({
  suites,
  days,
  cellMap,
  dayOccupancy,
  transferStartKeys,
  petName,
  onEmptyClick,
  onOccupiedClick,
  onDropOnSuite,
}: {
  suites: SuiteRow[];
  days: Date[];
  cellMap: Map<string, ResvRow>;
  dayOccupancy: Map<string, { occupied: number; total: number; pct: number }>;
  transferStartKeys: Set<string>;
  petName: (r: ResvRow) => string;
  onEmptyClick: (suiteId: string, day: Date) => void;
  onOccupiedClick: (r: ResvRow) => void;
  onDropOnSuite: (payload: DragPayload, targetSuite: SuiteRow) => void;
}) {
  const today = startOfDay(new Date());
  const [hoverSuite, setHoverSuite] = useState<string | null>(null);

  return (
    <div className="min-w-[800px]">
      <div
        className="grid border-b border-border bg-surface"
        style={{ gridTemplateColumns: `220px repeat(${days.length}, minmax(80px, 1fr))` }}
      >
        <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Suite
        </div>
        {days.map((d) => (
          <DayHeader
            key={d.toISOString()}
            day={d}
            occ={dayOccupancy.get(format(d, "yyyy-MM-dd"))}
            isToday={isSameDay(d, today)}
          />
        ))}
      </div>
      {suites.map((s) => {
        const isHover = hoverSuite === s.id;
        // Track which reservations have already been "anchored" (made draggable)
        // on an earlier visible day in this row, so multi-day stays only render
        // one draggable handle per row.
        const anchored = new Set<string>();
        return (
          <div
            key={s.id}
            className={cn(
              "grid border-b border-border-subtle last:border-b-0 transition-colors",
              isHover && "bg-accent-light/40 ring-2 ring-inset ring-accent",
            )}
            style={{ gridTemplateColumns: `220px repeat(${days.length}, minmax(80px, 1fr))` }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes("text/plain")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (hoverSuite !== s.id) setHoverSuite(s.id);
              }
            }}
            onDragLeave={(e) => {
              const rt = e.relatedTarget as Node | null;
              if (!rt || !(e.currentTarget as Node).contains(rt)) {
                setHoverSuite((prev) => (prev === s.id ? null : prev));
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setHoverSuite(null);
              const payload = readDragPayload(e);
              if (payload) onDropOnSuite(payload, s);
            }}
          >
            <div className="border-r border-border-subtle px-4 py-3">
              <SuiteRowHeader s={s} />
            </div>
            {days.map((d) => {
              const key = `${s.id}|${format(d, "yyyy-MM-dd")}`;
              const r = cellMap.get(key);
              const isTransfer = transferStartKeys.has(key);
              // Make the FIRST visible cell of a stay draggable (handles stays
              // that started before the visible week).
              const isDragHandle = !!r && !anchored.has(r.id);
              if (r && isDragHandle) anchored.add(r.id);
              return (
                <div
                  key={key}
                  className={cn(
                    "relative min-h-[64px] border-l border-border-subtle px-1.5 py-2 text-left text-xs transition-colors",
                    "bg-card",
                  )}
                >
                  {r ? (
                    <button
                      type="button"
                      draggable={isDragHandle}
                      onDragStart={(e) => {
                        if (!isDragHandle) {
                          e.preventDefault();
                          return;
                        }
                        writeDragPayload(e, {
                          reservationId: r.id,
                          fromSuiteId: s.id,
                          startKey: format(startOfDay(new Date(r.start_at)), "yyyy-MM-dd"),
                          endKey: format(startOfDay(new Date(r.end_at)), "yyyy-MM-dd"),
                        });
                        (e.currentTarget as HTMLElement).style.opacity = "0.4";
                      }}
                      onDragEnd={(e) => {
                        (e.currentTarget as HTMLElement).style.opacity = "";
                      }}
                      onClick={() => onOccupiedClick(r)}
                      className={cn(
                        "inline-flex max-w-full items-center truncate rounded-full px-2.5 py-1 text-[11px] font-medium shadow-sm transition-opacity hover:opacity-90",
                        r.status === "checked_in"
                          ? "bg-success text-white"
                          : "bg-primary text-primary-foreground",
                        isDragHandle ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                      )}
                      title={`${petName(r)}${isDragHandle ? " — drag to move suites" : ""}`}
                    >
                      <span className="truncate">{petName(r)}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onEmptyClick(s.id, d)}
                      className="h-full w-full text-left text-text-tertiary opacity-0 hover:opacity-100"
                    >
                      +
                    </button>
                  )}
                  {isTransfer && (
                    <span
                      className="absolute -left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-accent p-0.5 text-accent-foreground shadow"
                      title="Transferred from another suite"
                    >
                      <ArrowRightLeft className="h-3 w-3" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function MonthlyGrid({
  suites,
  days,
  cellMap,
  dayOccupancy,
  reservations,
  petName,
  rangeStart,
  rangeEnd,
  onCellClick,
  onDropOnSuite,
}: {
  suites: SuiteRow[];
  days: Date[];
  cellMap: Map<string, ResvRow>;
  dayOccupancy: Map<string, { occupied: number; total: number; pct: number }>;
  reservations: ResvRow[];
  petName: (r: ResvRow) => string;
  rangeStart: Date;
  rangeEnd: Date;
  onCellClick: (suiteId: string, day: Date) => void;
  onDropOnSuite: (payload: DragPayload, targetSuite: SuiteRow) => void;
}) {
  const today = startOfDay(new Date());
  const colWidth = 44;
  const [hoverSuite, setHoverSuite] = useState<string | null>(null);

  return (
    <div className="min-w-[1000px]">
      <div
        className="grid border-b border-border bg-surface"
        style={{ gridTemplateColumns: `200px repeat(${days.length}, ${colWidth}px)` }}
      >
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Suite
        </div>
        {days.map((d) => (
          <DayHeader
            key={d.toISOString()}
            day={d}
            occ={dayOccupancy.get(format(d, "yyyy-MM-dd"))}
            compact
            isToday={isSameDay(d, today)}
          />
        ))}
      </div>
      {suites.map((s) => {
        const suiteResvs = reservations.filter((r) => r.suite_id === s.id);
        const isHover = hoverSuite === s.id;
        return (
          <div
            key={s.id}
            className={cn(
              "relative grid border-b border-border-subtle last:border-b-0 transition-colors",
              isHover && "bg-accent-light/40 ring-2 ring-inset ring-accent",
            )}
            style={{ gridTemplateColumns: `200px repeat(${days.length}, ${colWidth}px)` }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes("text/plain")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (hoverSuite !== s.id) setHoverSuite(s.id);
              }
            }}
            onDragLeave={(e) => {
              const rt = e.relatedTarget as Node | null;
              if (!rt || !(e.currentTarget as Node).contains(rt)) {
                setHoverSuite((prev) => (prev === s.id ? null : prev));
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setHoverSuite(null);
              const payload = readDragPayload(e);
              if (payload) onDropOnSuite(payload, s);
            }}
          >
            <div className="border-r border-border-subtle px-4 py-3">
              <SuiteRowHeader s={s} />
            </div>
            {/* Background cells (clickable) */}
            {days.map((d) => {
              const r = cellMap.get(`${s.id}|${format(d, "yyyy-MM-dd")}`);
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => onCellClick(s.id, d)}
                  className={cn(
                    "h-12 border-l border-border-subtle bg-card hover:bg-surface",
                    isSameDay(d, today) && !r && "bg-primary-light/30",
                  )}
                  aria-label={r ? `Booked — ${s.name} on ${format(d, "MMM d")}` : `Available — ${s.name} on ${format(d, "MMM d")}`}
                />
              );
            })}
            {/* Reservation bars overlay */}
            {suiteResvs.map((r) => {
              const start = startOfDay(new Date(r.start_at));
              const end = startOfDay(new Date(r.end_at));
              const clampedStart = start < rangeStart ? rangeStart : start;
              const clampedEnd = end > rangeEnd ? rangeEnd : end;
              const startIdx = Math.max(
                0,
                Math.round((clampedStart.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)),
              );
              const span = Math.max(
                1,
                Math.round((clampedEnd.getTime() - clampedStart.getTime()) / (1000 * 60 * 60 * 24)) + 1,
              );
              const left = 200 + startIdx * colWidth + 2;
              const width = span * colWidth - 4;
              return (
                <button
                  key={r.id}
                  draggable
                  onDragStart={(e) => {
                    writeDragPayload(e, {
                      reservationId: r.id,
                      fromSuiteId: s.id,
                      startKey: format(start, "yyyy-MM-dd"),
                      endKey: format(end, "yyyy-MM-dd"),
                    });
                  }}
                  onClick={() => onCellClick(s.id, clampedStart)}
                  className={cn(
                    "pointer-events-auto absolute top-3 flex h-6 cursor-grab items-center truncate rounded-md px-2 text-[11px] font-medium shadow-sm transition-opacity hover:opacity-90 active:cursor-grabbing",
                    r.status === "checked_in"
                      ? "bg-success text-white"
                      : "bg-primary text-primary-foreground",
                  )}
                  style={{ left, width }}
                  title={`${petName(r)} — ${format(start, "MMM d")} to ${format(end, "MMM d")} · drag to move suites`}
                >
                  {petName(r)}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
