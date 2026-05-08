import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  LogIn,
  LogOut,
  Check,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  CalendarIcon,
  ChevronDown,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import PortalLayout from "@/components/portal/PortalLayout";
import { useAuth } from "@/hooks/useAuth";
import { useActiveStaff } from "@/contexts/StaffCodeContext";
import { greeting } from "@/lib/timezones";
import { supabase } from "@/integrations/supabase/client";
import { useLocationFilter } from "@/contexts/LocationContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { createInvoiceForReservation } from "@/lib/invoice";
import { tryConsumeCredits, formatCreditsUsed } from "@/lib/credits";
import { useLogActivity } from "@/hooks/useLogActivity";
import { reservationLabel, serviceLabel } from "@/components/portal/ReservationCells";
import { AddOnDialog } from "@/components/portal/AddOnDialog";
import SwitchServiceDialog from "@/components/portal/SwitchServiceDialog";
import { RecentCustomerUploads } from "@/components/portal/RecentCustomerUploads";
import { MoreVertical, Plus, Repeat } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTime } from "@/lib/money";

const TZ = "America/Edmonton";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type Row = {
  id: string;
  organization_id: string;
  location_id: string | null;
  primary_owner_id: string | null;
  service_id: string | null;
  start_at: string;
  end_at: string;
  status: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  suite_id: string | null;
  parent_reservation_id: string | null;
  services: { name: string | null; module: string | null } | null;
  owners: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    daycare_full_day_credits: number | null;
    daycare_half_day_credits: number | null;
    boarding_night_credits: number | null;
  } | null;
  suites: { name: string | null } | null;
  reservation_pets: { pets: { id: string; name: string | null; breed: string | null; photo_url: string | null } | null }[];
  add_ons: Array<{ id: string; services: { name: string | null; module: string | null } | null }> | null;
};

type DrillKey = "arriving" | "departing" | "overnight" | "onsite" | null;

/**
 * Fetch reservations whose schedule overlaps a given day-range.
 * Used twice in Dashboard: once for the date being viewed (drives KPIs +
 * drill-downs) and once for today (drives the operational tables, which stay
 * pinned to current state regardless of the date picker).
 */
async function fetchDashboardRange(
  rangeStart: Date,
  rangeEnd: Date,
  locationId: string | null | undefined,
): Promise<Row[]> {
  let q = supabase
    .from("reservations")
    .select(
      `id, organization_id, location_id, primary_owner_id, service_id, start_at, end_at, status, checked_in_at, checked_out_at, suite_id, parent_reservation_id,
       services:service_id(name, module),
       owners:primary_owner_id(id, first_name, last_name, daycare_full_day_credits, daycare_half_day_credits, boarding_night_credits),
       suites:suite_id(name),
       reservation_pets(pets(id, name, breed, photo_url)),
       add_ons:reservations!parent_reservation_id(id, services:service_id(name, module))`,
    )
    .is("deleted_at", null)
    .is("parent_reservation_id", null)
    .or(
      `and(start_at.gte.${rangeStart.toISOString()},start_at.lte.${rangeEnd.toISOString()}),and(checked_in_at.lte.${rangeEnd.toISOString()},or(checked_out_at.is.null,checked_out_at.gte.${rangeStart.toISOString()})),and(end_at.gte.${rangeStart.toISOString()},end_at.lte.${rangeEnd.toISOString()})`,
    )
    .order("start_at", { ascending: true });
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Row[];
}

export default function Dashboard() {
  const { profile, user, membership } = useAuth();
  const { activeStaff } = useActiveStaff();
  const qc = useQueryClient();
  const locationId = useLocationFilter();
  const log = useLogActivity();

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [drill, setDrill] = useState<DrillKey>(null);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [moduleFilter, setModuleFilter] = useState<"all" | "daycare" | "boarding" | "grooming" | "training">("all");
  const [searchTerm, setSearchTerm] = useState("");

  const dayStart = startOfDay(selectedDate);
  const dayEnd = endOfDay(selectedDate);

  // "today" is captured once on mount. The tables below the KPIs always reflect
  // today's operational state regardless of which date the picker is on; only
  // the KPI cards and drill panels follow the picker.
  const todayBase = useMemo(() => new Date(), []);
  const todayStart = useMemo(() => startOfDay(todayBase), [todayBase]);
  const todayEnd = useMemo(() => endOfDay(todayBase), [todayBase]);

  // KPI / drill-down dataset (selected date)
  const { data: rows = [] } = useQuery({
    queryKey: ["dashboard-day", locationId, dayStart.toISOString()],
    queryFn: () => fetchDashboardRange(dayStart, dayEnd, locationId),
  });

  // Operational dataset for the tables (always today). When the picker is on
  // today, both queries share a key and React Query dedupes — no extra fetch.
  const { data: todayRows = [] } = useQuery({
    queryKey: ["dashboard-day", locationId, todayStart.toISOString()],
    queryFn: () => fetchDashboardRange(todayStart, todayEnd, locationId),
  });

  // Apply module filter pill to both datasets (filter affects KPIs *and* tables)
  const filteredRows = useMemo(() => {
    if (moduleFilter === "all") return rows;
    return rows.filter((r) => r.services?.module === moduleFilter);
  }, [rows, moduleFilter]);

  const todayFilteredRows = useMemo(() => {
    if (moduleFilter === "all") return todayRows;
    return todayRows.filter((r) => r.services?.module === moduleFilter);
  }, [todayRows, moduleFilter]);

  // Apply search term across pet + owner names
  const searchFilter = (list: Row[]) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return list;
    return list.filter((r) => {
      const pets = petNames(r).toLowerCase();
      const owner = ownerName(r).toLowerCase();
      return pets.includes(term) || owner.includes(term);
    });
  };

  // Selected-date aggregates → power KPI cards + drill-down panels
  const expectedAll = useMemo(
    () =>
      filteredRows.filter(
        (r) =>
          r.status === "confirmed" &&
          new Date(r.start_at) >= dayStart &&
          new Date(r.start_at) <= dayEnd,
      ),
    [filteredRows, dayStart, dayEnd],
  );

  const checkedInAll = useMemo(
    () =>
      filteredRows.filter(
        (r) =>
          r.status === "checked_in" &&
          (!r.checked_in_at || new Date(r.checked_in_at) <= dayEnd) &&
          (!r.checked_out_at || new Date(r.checked_out_at) >= dayStart),
      ),
    [filteredRows, dayStart, dayEnd],
  );

  const goingHomeAll = useMemo(
    () =>
      filteredRows.filter(
        (r) =>
          r.status === "checked_in" &&
          new Date(r.end_at) >= dayStart &&
          new Date(r.end_at) <= dayEnd,
      ),
    [filteredRows, dayStart, dayEnd],
  );

  const requestedAll = useMemo(
    () =>
      filteredRows.filter(
        (r) =>
          r.status === "requested" &&
          new Date(r.start_at) >= dayStart &&
          new Date(r.start_at) <= dayEnd,
      ),
    [filteredRows, dayStart, dayEnd],
  );

  // Today-pinned aggregates → power the operational tables below the KPIs
  const todayExpectedAll = useMemo(
    () =>
      todayFilteredRows.filter(
        (r) =>
          r.status === "confirmed" &&
          new Date(r.start_at) >= todayStart &&
          new Date(r.start_at) <= todayEnd,
      ),
    [todayFilteredRows, todayStart, todayEnd],
  );

  const todayCheckedInAll = useMemo(
    () =>
      todayFilteredRows.filter(
        (r) =>
          r.status === "checked_in" &&
          (!r.checked_in_at || new Date(r.checked_in_at) <= todayEnd) &&
          (!r.checked_out_at || new Date(r.checked_out_at) >= todayStart),
      ),
    [todayFilteredRows, todayStart, todayEnd],
  );

  const todayGoingHomeAll = useMemo(
    () =>
      todayFilteredRows.filter(
        (r) =>
          r.status === "checked_in" &&
          new Date(r.end_at) >= todayStart &&
          new Date(r.end_at) <= todayEnd,
      ),
    [todayFilteredRows, todayStart, todayEnd],
  );

  const todayRequestedAll = useMemo(
    () =>
      todayFilteredRows.filter(
        (r) =>
          r.status === "requested" &&
          new Date(r.start_at) >= todayStart &&
          new Date(r.start_at) <= todayEnd,
      ),
    [todayFilteredRows, todayStart, todayEnd],
  );

  // Search-filtered versions for the tabs (always today-based)
  const expected = useMemo(() => searchFilter(todayExpectedAll), [todayExpectedAll, searchTerm]);
  const checkedIn = useMemo(() => searchFilter(todayCheckedInAll), [todayCheckedInAll, searchTerm]);
  const goingHome = useMemo(() => searchFilter(todayGoingHomeAll), [todayGoingHomeAll, searchTerm]);
  const requested = useMemo(() => searchFilter(todayRequestedAll), [todayRequestedAll, searchTerm]);

  // Counters use the (unsearched) filtered totals so KPIs reflect day+module
  const arrivingCount = expectedAll.length;
  const departingCount = goingHomeAll.length;
  const overnight = useMemo(
    () =>
      checkedInAll.filter(
        (r) => r.services?.module === "boarding" && new Date(r.end_at) > dayEnd,
      ),
    [checkedInAll, dayEnd],
  );
  const overnightCount = overnight.length;
  const onSiteCount = checkedInAll.length;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dashboard-day"] });
    qc.invalidateQueries({ queryKey: ["schedule-day"] });
    qc.invalidateQueries({ queryKey: ["schedule-week"] });
  };

  const checkInMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("reservations")
        .update({
          status: "checked_in",
          checked_in_at: new Date().toISOString(),
          checked_in_by_user_id: user?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
      if (membership?.organization_id) {
        await log({
          organization_id: membership.organization_id,
          action: "checked_in",
          entity_type: "reservation",
          entity_id: id,
        });
      }
    },
    onSuccess: () => {
      toast.success("Checked in. Pet is on site.");
      invalidate();
    },
    onError: () => toast.error("Couldn't check in. Try again."),
  });

  const checkOutMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("reservations")
        .update({
          status: "checked_out",
          checked_out_at: new Date().toISOString(),
          checked_out_by_user_id: user?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
      if (membership?.organization_id) {
        await log({
          organization_id: membership.organization_id,
          action: "checked_out",
          entity_type: "reservation",
          entity_id: id,
        });
      }
      return id;
    },
    onSuccess: async (id) => {
      invalidate();
      try {
        // Try to consume credits first. If the owner has enough, no invoice
        // is created — this is the common path for daycare/boarding regulars.
        const actor = activeStaff
          ? { kind: "staff" as const, label: activeStaff.display_name || "Staff", staffCodeId: activeStaff.id }
          : profile
            ? {
                kind: "staff" as const,
                label:
                  [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
                  profile.email ||
                  "Staff",
              }
            : { kind: "system" as const, label: "System" };
        const result = await tryConsumeCredits(id, actor);
        if (result.used) {
          toast.success(`Checked out. Used ${formatCreditsUsed(result.creditsUsed)}.`);
          return;
        }
        // Fall back to invoicing for: services (grooming/training), owners
        // without sufficient credits, or no owner on the reservation.
        const inv = await createInvoiceForReservation(id);
        if (!inv.alreadyExisted) {
          toast.success(`Checked out. Invoice ${inv.invoice_number ?? ""} ready.`, {
            action: {
              label: "View",
              onClick: () => window.location.assign(`/invoices/${inv.id}`),
            },
          });
        } else {
          toast.success("Checked out.");
        }
        qc.invalidateQueries({ queryKey: ["invoices-list"] });
      } catch {
        toast.error("Checked out, but couldn't process credits or invoice. Try again or invoice manually.");
      }
    },
    onError: () => toast.error("Couldn't check out. Try again."),
  });

  const approveMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reservations").update({ status: "confirmed" }).eq("id", id);
      if (error) throw error;
      if (membership?.organization_id) {
        await log({
          organization_id: membership.organization_id,
          action: "confirmed",
          entity_type: "reservation",
          entity_id: id,
        });
      }
    },
    onSuccess: () => {
      toast.success("Approved.");
      invalidate();
    },
    onError: () => toast.error("Couldn't approve. Try again."),
  });

  const declineMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reservations").update({ status: "cancelled" }).eq("id", id);
      if (error) throw error;
      if (membership?.organization_id) {
        await log({
          organization_id: membership.organization_id,
          action: "cancelled",
          entity_type: "reservation",
          entity_id: id,
          metadata: { reason: "Request declined" },
        });
      }
    },
    onSuccess: () => {
      toast.success("Declined.");
      invalidate();
    },
    onError: () => toast.error("Couldn't decline. Try again."),
  });

  const [quickOpen, setQuickOpen] = useState(false);

  const firstName = profile?.first_name || "";
  const dateLabel = selectedDate.toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Regina",
  });
  const today = new Date();
  const isToday = isSameDay(selectedDate, today);

  // Subtitle always reflects today — it describes the current state of the
  // building, not the date being viewed in the KPI cards above.
  const subtitle = (() => {
    const todayOnSite = todayCheckedInAll.length;
    const todayRequests = todayRequestedAll.length;
    const inPackText = `${todayOnSite} in the pack`;
    if (todayRequests > 0) {
      const reqText = `${todayRequests} request${todayRequests === 1 ? "" : "s"} waiting`;
      return todayOnSite > 0 ? `${reqText} · ${inPackText}` : reqText;
    }
    return todayOnSite > 0 ? `All caught up. ${inPackText}.` : "All caught up.";
  })();

  const shiftDay = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d);
    setDrill(null);
  };

  const kpis: { key: Exclude<DrillKey, null>; label: string; value: number; bar: string; bg: string }[] = [
    { key: "arriving", label: "Coming In", value: arrivingCount, bar: "bg-success", bg: "bg-brand-mist-bg" },
    { key: "departing", label: "Going Home", value: departingCount, bar: "bg-teal", bg: "bg-brand-frost-bg" },
    { key: "overnight", label: "Sleeping Over", value: overnightCount, bar: "bg-plum", bg: "bg-brand-cotton-bg" },
    { key: "onsite", label: "In The Pack", value: onSiteCount, bar: "bg-primary", bg: "bg-brand-vanilla-bg" },
  ];

  const toggleDrill = (k: Exclude<DrillKey, null>) => setDrill((cur) => (cur === k ? null : k));

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <header className="mb-5">
          <h1 className="font-display text-2xl text-foreground">
            {greeting()}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {subtitle}
          </p>
        </header>

        {/* Date Navigation */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftDay(-1)} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant={isToday ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setSelectedDate(new Date());
              setDrill(null);
            }}
          >
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => shiftDay(1)} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2 font-normal">
                <CalendarIcon className="h-4 w-4" />
                {dateLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => {
                  if (d) {
                    setSelectedDate(d);
                    setDrill(null);
                    setDatePopoverOpen(false);
                  }
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        <RecentCustomerUploads />

        {/* Daily Summary */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => {
            const active = drill === k.key;
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => toggleDrill(k.key)}
                className={cn(
                  "group relative overflow-hidden rounded-lg border p-5 text-left shadow-card transition-all",
                  k.bg,
                  active ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40",
                )}
              >
                <span className={`absolute left-0 top-0 h-full w-1 ${k.bar}`} />
                <div className="flex items-start justify-between">
                  <div>
                    <div className="label-eyebrow">{k.label}</div>
                    <div className="mt-2 font-display text-3xl font-bold text-foreground">{k.value}</div>
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-text-tertiary transition-transform",
                      active && "rotate-180 text-primary",
                    )}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Drill-down panel */}
        {drill && (
          <section className="mb-6 animate-fade-in overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
              <h2 className="font-display text-base font-semibold text-foreground">
                {drill === "arriving" && "Coming In Today"}
                {drill === "departing" && "Going Home Today"}
                {drill === "overnight" && "Sleeping Over Tonight"}
                {drill === "onsite" && "In The Pack Now"}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setDrill(null)} className="gap-1">
                <X className="h-3.5 w-3.5" />
                Close
              </Button>
            </div>
            {drill === "arriving" && (
              <GroupedTable
                rows={expectedAll}
                emptyText="No arrivals scheduled. Add a reservation to fill the day."
                columns={["Pet", "Owner", "Reservation", "Service", "Start", "End", "Status"]}
                renderRow={(r) => [
                  <PetCell r={r} />,
                  <OwnerCell r={r} />,
                  reservationLabel(r.services),
                  serviceLabel(r.services),
                  formatDayTime(effectiveStart(r)),
                  formatDayTime(effectiveEnd(r)),
                  <StatusPill label={r.status === "confirmed" ? "Confirmed" : "Pending"} tone={r.status === "confirmed" ? "success" : "neutral"} />,
                ]}
              />
            )}
            {drill === "departing" && (
              <GroupedTable
                rows={goingHomeAll}
                emptyText="No departures scheduled."
                columns={["Pet", "Owner", "Reservation", "Service", "Start", "End", "Status"]}
                renderRow={(r) => [
                  <PetCell r={r} />,
                  <OwnerCell r={r} />,
                  reservationLabel(r.services),
                  serviceLabel(r.services),
                  formatDayTime(effectiveStart(r)),
                  formatDayTime(effectiveEnd(r)),
                  <StatusPill label={r.checked_out_at ? "Checked Out" : "Ready for pickup"} tone="teal" />,
                ]}
              />
            )}
            {drill === "overnight" && (
              <FlatTable
                rows={overnight}
                emptyText="No overnight stays tonight."
                columns={["Pet", "Owner", "Start", "End", "Nights Remaining"]}
                renderRow={(r) => {
                  const end = new Date(r.end_at);
                  const nights = Math.max(
                    0,
                    Math.ceil((end.getTime() - dayEnd.getTime()) / (1000 * 60 * 60 * 24)),
                  );
                  return [
                    <PetCell r={r} />,
                    <OwnerCell r={r} />,
                    formatDayTime(effectiveStart(r)),
                    formatDayTime(effectiveEnd(r)),
                    `${nights} night${nights === 1 ? "" : "s"}`,
                  ];
                }}
              />
            )}
            {drill === "onsite" && (
              <GroupedTable
                rows={checkedInAll}
                emptyText="Nothing on site right now. Quiet day."
                columns={["Pet", "Owner", "Reservation", "Service", "Start", "End"]}
                renderRow={(r) => [
                  <PetCell r={r} />,
                  <OwnerCell r={r} />,
                  reservationLabel(r.services),
                  serviceLabel(r.services),
                  formatDayTime(effectiveStart(r)),
                  formatDayTime(effectiveEnd(r)),
                ]}
              />
            )}
          </section>
        )}

        {/* Service type filter pills */}
        <div className="mb-5 flex flex-wrap gap-2">
          {(
            [
              { key: "all", label: "All" },
              { key: "daycare", label: "Daycare" },
              { key: "boarding", label: "Boarding" },
              { key: "grooming", label: "Grooming" },
              { key: "training", label: "Training" },
            ] as const
          ).map((p) => {
            const active = moduleFilter === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setModuleFilter(p.key);
                  setDrill(null);
                }}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Quick Actions */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            onClick={() => setQuickOpen(true)}
            className="gap-2"
            title="Find and check in any expected pet"
          >
            <Search className="h-4 w-4" />
            Quick Check-In
          </Button>
        </div>

        {/* Today's Reservations */}
        <section className="rounded-lg border border-border bg-surface shadow-card">
          {/* Search bar (persists across tabs) */}
          <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search pets or owners"
                className="pl-9 pr-9"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-tertiary hover:bg-background hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {searchTerm && expected.length + checkedIn.length + goingHome.length + requested.length > 0 && (
              <span className="text-xs text-text-secondary">
                {expected.length + checkedIn.length + goingHome.length + requested.length} of{" "}
                {todayExpectedAll.length + todayCheckedInAll.length + todayGoingHomeAll.length + todayRequestedAll.length} match
              </span>
            )}
          </div>
          <Tabs defaultValue="expected" className="w-full">
            <div className="border-b border-border-subtle px-5 pt-4 pb-3">
              <TabsList>
                <TabsTrigger value="expected" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Coming In ({expected.length})</TabsTrigger>
                <TabsTrigger value="checkedin" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">In The Pack ({checkedIn.length})</TabsTrigger>
                <TabsTrigger value="going" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Going Home ({goingHome.length})</TabsTrigger>
                <TabsTrigger value="requested" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Requests ({requested.length})</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="expected" className="m-0">
              <ResTable
                rows={expected}
                emptyText="No arrivals today. You're all caught up."
                action={(r) => (
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      onClick={() => checkInMut.mutate(r.id)}
                      disabled={checkInMut.isPending}
                      className="gap-1"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      Check In
                    </Button>
                    {/* Inline overflow menu — gets the click-count for
                        Switch service and Add add-on under four. The
                        canonical Switch dialog and AddOnDialog open
                        from this menu without a detail-page round-trip. */}
                    <RowActions r={r} canSwitchService canAddAddOn invalidate={invalidate} />
                  </div>
                )}
              />
            </TabsContent>

            <TabsContent value="checkedin" className="m-0">
              <ResTable
                rows={checkedIn}
                emptyText="Nobody checked in yet. The first arrival will appear here."
                action={(r) => (
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => checkOutMut.mutate(r.id)}
                      disabled={checkOutMut.isPending}
                      className="gap-1"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Check Out
                    </Button>
                    {/* Switch service is intentionally NOT offered after
                        check-in — the original audit's canSwitchService
                        rule (`requested` or `confirmed` only) keeps the
                        invariant that credits / invoicing keyed off the
                        original service module never get retroactively
                        rewritten. Add-on is fine post-arrival. */}
                    <RowActions r={r} canAddAddOn invalidate={invalidate} />
                  </div>
                )}
              />
            </TabsContent>

            <TabsContent value="going" className="m-0">
              <ResTable
                rows={goingHome}
                emptyText="No departures today."
                action={(r) => (
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => checkOutMut.mutate(r.id)}
                      disabled={checkOutMut.isPending}
                      className="gap-1"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Check Out
                    </Button>
                    <RowActions r={r} canAddAddOn invalidate={invalidate} />
                  </div>
                )}
              />
            </TabsContent>

            <TabsContent value="requested" className="m-0">
              <RequestedTable
                rows={requested}
                onApprove={(id) => approveMut.mutate(id)}
                onDecline={(id) => declineMut.mutate(id)}
                isApproving={approveMut.isPending}
                isDeclining={declineMut.isPending}
              />
            </TabsContent>
          </Tabs>
        </section>
      </div>

      <QuickCheckInDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        candidates={expected}
        onCheckIn={(id) => {
          checkInMut.mutate(id);
          setQuickOpen(false);
        }}
        loading={checkInMut.isPending}
      />
    </PortalLayout>
  );
}

function petNames(r: Row) {
  return (r.reservation_pets ?? [])
    .map((rp) => rp.pets?.name)
    .filter(Boolean)
    .join(", ");
}

function ownerName(r: Row) {
  return [r.owners?.first_name, r.owners?.last_name].filter(Boolean).join(" ") || "—";
}

function PetCell({ r }: { r: Row }) {
  const pets = (r.reservation_pets ?? [])
    .map((rp) => rp.pets)
    .filter(Boolean) as NonNullable<Row["reservation_pets"][number]["pets"]>[];
  const first = pets[0];
  const extra = Math.max(0, pets.length - 1);
  return (
    <Link to={`/reservations/${r.id}`} className="group flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {first?.photo_url ? (
          <img src={first.photo_url} alt={first.name ?? ""} className="h-full w-full object-cover" />
        ) : (
          (first?.name?.[0] ?? "?").toUpperCase()
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground group-hover:text-primary">
          {first?.name ?? "—"}
          {extra > 0 && <span className="ml-1 text-text-tertiary">+{extra}</span>}
        </div>
        {first?.breed && (
          <div className="truncate text-xs text-text-secondary">{first.breed}</div>
        )}
      </div>
    </Link>
  );
}

function OwnerCell({ r }: { r: Row }) {
  const credits = ownerCreditSummary(r.owners);
  return (
    <div className="min-w-0">
      <div className="truncate text-text-secondary">{ownerName(r)}</div>
      {credits && (
        <div className="truncate text-[11px] text-text-tertiary">{credits}</div>
      )}
    </div>
  );
}

function ownerCreditSummary(o: Row["owners"]): string | null {
  if (!o) return null;
  const full = o.daycare_full_day_credits ?? 0;
  const half = o.daycare_half_day_credits ?? 0;
  const nights = o.boarding_night_credits ?? 0;
  const parts: string[] = [];
  if (full > 0) parts.push(`${full} full`);
  if (half > 0) parts.push(`${half} half`);
  if (nights > 0) parts.push(`${nights} ${nights === 1 ? "night" : "nights"}`);
  return parts.length ? parts.join(" · ") : null;
}

function formatDayTime(iso: string): string {
  const date = new Date(iso).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: TZ,
  });
  return `${date} · ${formatTime(iso, TZ)}`;
}

/** Effective start: actual check-in time once checked in, else scheduled start. */
function effectiveStart(r: Row): string {
  return r.checked_in_at ?? r.start_at;
}

/** Effective end: actual check-out time once checked out, else scheduled end. */
function effectiveEnd(r: Row): string {
  return r.checked_out_at ?? r.end_at;
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "warning" | "teal" | "neutral" }) {
  const cls =
    tone === "success"
      ? "bg-success-bg text-success"
      : tone === "warning"
        ? "bg-warning-bg text-warning"
        : tone === "neutral"
          ? "bg-muted text-muted-foreground"
          : "bg-brand-frost-bg text-teal";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", cls)}>
      {label}
    </span>
  );
}

function moduleLabel(m: string | null | undefined) {
  switch (m) {
    case "daycare":
      return "Daycare";
    case "boarding":
      return "Boarding";
    case "grooming":
      return "Grooming";
    case "training":
      return "Training";
    default:
      return "Other";
  }
}

function FlatTable({
  rows,
  emptyText,
  columns,
  renderRow,
}: {
  rows: Row[];
  emptyText: string;
  columns: string[];
  renderRow: (r: Row) => React.ReactNode[];
}) {
  if (rows.length === 0) {
    return (
      <div className="px-5 py-10 text-center font-display text-sm text-text-secondary">{emptyText}</div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-background">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            {columns.map((c) => (
              <th key={c} className="px-5 py-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cells = renderRow(r);
            return (
              <tr key={r.id} className="border-t border-border-subtle hover:bg-background/60">
                {cells.map((c, i) => (
                  <td key={i} className="px-5 py-3 text-text-secondary">
                    {c}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupedTable({
  rows,
  emptyText,
  columns,
  renderRow,
}: {
  rows: Row[];
  emptyText: string;
  columns: string[];
  renderRow: (r: Row) => React.ReactNode[];
}) {
  if (rows.length === 0) {
    return (
      <div className="px-5 py-10 text-center font-display text-sm text-text-secondary">{emptyText}</div>
    );
  }
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = moduleLabel(r.services?.module);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const order = ["Daycare", "Boarding", "Grooming", "Training", "Other"];
  const sorted = Array.from(groups.entries()).sort(
    (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]),
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-background">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            {columns.map((c) => (
              <th key={c} className="px-5 py-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(([group, list]) => (
            <React.Fragment key={`grp-${group}`}>
              <tr className="bg-background/60">
                <td
                  colSpan={columns.length}
                  className="px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary"
                >
                  {group} · {list.length}
                </td>
              </tr>
              {list.map((r) => {
                const cells = renderRow(r);
                return (
                  <tr key={r.id} className="border-t border-border-subtle hover:bg-background/60">
                    {cells.map((c, i) => (
                      <td key={i} className="px-5 py-3 text-text-secondary">
                        {c}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResTable({
  rows,
  emptyText,
  action,
}: {
  rows: Row[];
  emptyText: string;
  action: (r: Row) => React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-background">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            <th className="px-5 py-3">Pet</th>
            <th className="px-5 py-3">Owner</th>
            <th className="px-5 py-3">Reservation</th>
            <th className="px-5 py-3">Service</th>
            <th className="px-5 py-3">Start</th>
            <th className="px-5 py-3">End</th>
            <th className="px-5 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-5 py-12 text-center">
                <div className="font-display text-base text-foreground">{emptyText}</div>
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="border-t border-border-subtle hover:bg-background/60">
                <td className="px-5 py-3"><PetCell r={r} /></td>
                <td className="px-5 py-3"><OwnerCell r={r} /></td>
                <td className="px-5 py-3 text-text-secondary">{reservationLabel(r.services)}</td>
                <td className="px-5 py-3 text-text-secondary">{serviceLabel(r.services)}</td>
                <td className="px-5 py-3 text-text-secondary whitespace-nowrap">{formatDayTime(effectiveStart(r))}</td>
                <td className="px-5 py-3 text-text-secondary whitespace-nowrap">{formatDayTime(effectiveEnd(r))}</td>
                <td className="px-5 py-3 text-right">{action(r)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function RequestedTable({
  rows,
  onApprove,
  onDecline,
  isApproving,
  isDeclining,
}: {
  rows: Row[];
  onApprove: (id: string) => void;
  onDecline: (id: string) => void;
  isApproving: boolean;
  isDeclining: boolean;
}) {
  const [addOnFor, setAddOnFor] = useState<Row | null>(null);

  if (rows.length === 0) {
    return (
      <div className="px-5 py-12 text-center font-display text-base text-foreground">
        No requests waiting. New booking requests appear here.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-background">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            <th className="px-5 py-3">Pet</th>
            <th className="px-5 py-3">Owner</th>
            <th className="px-5 py-3">Reservation</th>
            <th className="px-5 py-3">Service</th>
            <th className="px-5 py-3">Start</th>
            <th className="px-5 py-3">End</th>
            <th className="px-5 py-3">Suite</th>
            <th className="px-5 py-3">Add-on</th>
            <th className="px-5 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isParentReservation =
              r.services?.module === "daycare" || r.services?.module === "boarding";
            const hasAddOns = !!(r.add_ons && r.add_ons.length > 0);
            return (
              <tr key={r.id} className="border-t border-border-subtle hover:bg-background/60">
                <td className="px-5 py-3"><PetCell r={r} /></td>
                <td className="px-5 py-3"><OwnerCell r={r} /></td>
                <td className="px-5 py-3 text-text-secondary">{reservationLabel(r.services)}</td>
                <td className="px-5 py-3 text-text-secondary">{serviceLabel(r.services)}</td>
                <td className="px-5 py-3 text-text-secondary whitespace-nowrap">{formatDayTime(effectiveStart(r))}</td>
                <td className="px-5 py-3 text-text-secondary whitespace-nowrap">{formatDayTime(effectiveEnd(r))}</td>
                <td className="px-5 py-3 text-text-secondary">{r.suites?.name ?? "—"}</td>
                <td className="px-5 py-3 text-text-secondary">
                  {hasAddOns ? (
                    r.add_ons!.map((a) => a.services?.name ?? "Service").join(", ")
                  ) : isParentReservation ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => setAddOnFor(r)}
                    >
                      <Plus className="h-3 w-3" />
                      Add
                    </Button>
                  ) : (
                    <span className="text-text-tertiary">—</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" onClick={() => onApprove(r.id)} disabled={isApproving} className="gap-1">
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onDecline(r.id)} disabled={isDeclining} className="gap-1">
                      <X className="h-3.5 w-3.5" />
                      Decline
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {addOnFor && (
        <AddOnDialog
          open={!!addOnFor}
          onOpenChange={(o) => !o && setAddOnFor(null)}
          parent={{
            id: addOnFor.id,
            organization_id: addOnFor.organization_id,
            location_id: addOnFor.location_id,
            primary_owner_id: addOnFor.primary_owner_id,
            start_at: addOnFor.start_at,
            end_at: addOnFor.end_at,
          }}
          petId={addOnFor.reservation_pets?.[0]?.pets?.id ?? ""}
        />
      )}
    </div>
  );
}

function QuickCheckInDialog({
  open,
  onOpenChange,
  candidates,
  onCheckIn,
  loading,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  candidates: Row[];
  onCheckIn: (id: string) => void;
  loading: boolean;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return candidates;
    return candidates.filter((r) => {
      const pets = petNames(r).toLowerCase();
      const owner = ownerName(r).toLowerCase();
      return pets.includes(term) || owner.includes(term);
    });
  }, [candidates, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick Check-In</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pets or owners"
            className="pl-9"
          />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border border-border-subtle">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-text-secondary">
              {candidates.length === 0 ? "Nothing to check in today." : "No matches. Try a different name."}
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {filtered.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{petNames(r) || "—"}</div>
                    <div className="truncate text-xs text-text-secondary">
                      {ownerName(r)} · {r.services?.name ?? "—"} · {formatTime(r.start_at, TZ)}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => onCheckIn(r.id)} disabled={loading} className="gap-1">
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
                    Check In
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Per-row overflow menu rendered to the right of the primary action
// button on each Dashboard row. Hosts the Switch service and Add
// add-on dialogs inline so neither flow needs a detail-page
// round-trip (closes the click-count gap from
// docs/click-counts-2026-Q2.md).
//
// Owns its own dialog state so each row's menu is independent —
// opening one row's "Switch service" doesn't touch another row's
// state.
function RowActions({
  r,
  canSwitchService,
  canAddAddOn,
  invalidate,
}: {
  r: Row;
  canSwitchService?: boolean;
  canAddAddOn?: boolean;
  invalidate: () => void;
}) {
  const [switchOpen, setSwitchOpen] = useState(false);
  const [addOnOpen, setAddOnOpen] = useState(false);

  // Hide the menu entirely if neither action applies for this row's
  // status — keeps the row visually clean in the rare case the menu
  // would have nothing in it.
  if (!canSwitchService && !canAddAddOn) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            aria-label="More actions"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canSwitchService && (
            <DropdownMenuItem onClick={() => setSwitchOpen(true)}>
              <Repeat className="mr-2 h-3.5 w-3.5" />
              Switch service
            </DropdownMenuItem>
          )}
          {canAddAddOn && (
            <DropdownMenuItem onClick={() => setAddOnOpen(true)}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              Add add-on
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canSwitchService && (
        <SwitchServiceDialog
          open={switchOpen}
          onOpenChange={setSwitchOpen}
          reservationId={r.id}
          currentServiceId={r.service_id ?? null}
          currentServiceName={r.services?.name ?? null}
          onSaved={invalidate}
        />
      )}

      {canAddAddOn && (
        <AddOnDialog
          open={addOnOpen}
          onOpenChange={setAddOnOpen}
          parent={{
            id: r.id,
            organization_id: r.organization_id,
            location_id: r.location_id,
            primary_owner_id: r.primary_owner_id,
            start_at: r.start_at,
            end_at: r.end_at,
          }}
          petId={r.reservation_pets?.[0]?.pets?.id ?? ""}
        />
      )}
    </>
  );
}
