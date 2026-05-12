import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, ClipboardList, Download, Search, X } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import ReservationStatusBadge from "@/components/portal/ReservationStatusBadge";
import {
  PetCell,
  OwnerCell,
  formatDayTime,
  effectiveStart,
  effectiveEnd,
  reservationLabel,
  serviceLabel,
} from "@/components/portal/ReservationCells";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useLocationFilter } from "@/contexts/LocationContext";
import { downloadCsv, toCsv } from "@/lib/csv";
import { toArray } from "@/lib/postgrest";

const PAGE_SIZE = 10;

type ModuleFilter = "all" | "daycare" | "boarding" | "grooming" | "training";

function startOfWeekISO() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day;
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start.toISOString().slice(0, 10);
}
function endOfWeekISO() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() + (6 - day);
  const end = new Date(d.setDate(diff));
  end.setHours(23, 59, 59, 999);
  return end.toISOString().slice(0, 10);
}

/**
 * ReservationsListSection — body-only (no PortalLayout, no PageHeader wrapper).
 * Used inside the merged /reservations page that provides its own header + tabs.
 *
 * This is the *detailed* view of all bookings — Pack View is the day-glance,
 * this is the full ledger with richer per-row data and broader filters.
 */
export function ReservationsListSection({ headerSlot }: { headerSlot?: React.ReactNode }) {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canCreate = can("reservations.create");
  const locationId = useLocationFilter();
  const [startDate, setStartDate] = useState<string>(startOfWeekISO());
  const [endDate, setEndDate] = useState<string>(endOfWeekISO());
  const [status, setStatus] = useState<string>("all");
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["reservations", startDate, endDate, status, moduleFilter, page, locationId],
    queryFn: async () => {
      // !inner on services lets us filter parent rows by the joined module column
      const baseSelect = `id, start_at, end_at, status, source, created_at, suite_id,
         checked_in_at, checked_out_at, primary_owner_id,
         owners:primary_owner_id(first_name, last_name, daycare_full_day_credits, daycare_half_day_credits, boarding_night_credits),
         services!inner(name, module),
         suites:suite_id(name),
         reservation_pets(pet_id, pets(id, name, breed, photo_url))`;

      let q = supabase
        .from("reservations")
        .select(baseSelect, { count: "exact" })
        .is("deleted_at", null)
        .order("start_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (startDate) q = q.gte("start_at", new Date(startDate + "T00:00:00").toISOString());
      if (endDate) q = q.lte("start_at", new Date(endDate + "T23:59:59").toISOString());
      if (status !== "all") q = q.eq("status", status as any);
      if (moduleFilter !== "all") q = q.eq("services.module", moduleFilter as any);
      if (locationId) q = q.eq("location_id", locationId);

      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const totalPages = useMemo(() => Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE)), [data?.count]);

  // Search filters the *current page* only — full-result-set search would
  // require a server-side fuzzy join; not worth that complexity yet.
  const visibleRows = useMemo(() => {
    const rows = data?.rows ?? [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r: any) => {
      const owner = `${r.owners?.first_name ?? ""} ${r.owners?.last_name ?? ""}`.toLowerCase();
      const pets = toArray((r as any).reservation_pets)
        .map((rp: any) => rp.pets?.name)
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return owner.includes(term) || pets.includes(term);
    });
  }, [data?.rows, searchTerm]);

  const modulePills: Array<{ key: ModuleFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "daycare", label: "Daycare" },
    { key: "boarding", label: "Boarding" },
    { key: "grooming", label: "Grooming" },
    { key: "training", label: "Training" },
  ];

  return (
    <>
      <PageHeader
        title="Reservations"
        description={headerSlot}
        actions={
          <div className="flex gap-2">
            {can("data.export") && (
              <Button
                variant="outline"
                onClick={() => {
                  const rows = (data?.rows ?? []).map((r: any) => ({
                    start_at: r.start_at,
                    end_at: r.end_at,
                    status: r.status,
                    source: r.source,
                    suite: r.suites?.name ?? "",
                    owner: r.owners ? `${r.owners.first_name} ${r.owners.last_name}` : "",
                    service: r.services?.name ?? "",
                    pets: toArray((r as any).reservation_pets).map((rp: any) => rp.pets?.name).filter(Boolean).join("; "),
                    created_at: r.created_at,
                  }));
                  downloadCsv(`reservations-${startDate}-to-${endDate}.csv`, toCsv(rows));
                }}
              >
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            )}
            {canCreate && (
              <Button onClick={() => navigate("/reservations/new")}>
                <Plus className="h-4 w-4" /> New Reservation
              </Button>
            )}
          </div>
        }
      />

      <div className="rounded-lg border border-border bg-surface shadow-card">
        {/* Filter row 1: date range + status */}
        <div className="flex flex-wrap items-end gap-3 border-b border-border-subtle p-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-text-secondary">From</label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setPage(0);
                setStartDate(e.target.value);
              }}
              className="bg-background"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-text-secondary">To</label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => {
                setPage(0);
                setEndDate(e.target.value);
              }}
              className="bg-background"
            />
          </div>
          <div className="w-44">
            <label className="mb-1 block text-[11px] font-semibold text-text-secondary">Status</label>
            <Select value={status} onValueChange={(v) => { setPage(0); setStatus(v); }}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="requested">Requested</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="checked_in">Checked In</SelectItem>
                <SelectItem value="checked_out">Checked Out</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="no_show">No Show</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex-1 min-w-[240px]">
            <label className="mb-1 block text-[11px] font-semibold text-text-secondary">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search pets or owners on this page"
                className="bg-background pl-9 pr-9"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-tertiary hover:bg-surface hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filter row 2: module quick-filter pills */}
        <div className="flex flex-wrap gap-2 border-b border-border-subtle px-4 py-3">
          {modulePills.map((p) => {
            const active = moduleFilter === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setModuleFilter(p.key);
                  setPage(0);
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

        {isLoading ? (
          <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
        ) : data && data.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={ClipboardList}
              title="No reservations match these filters"
              description="Try widening the date range or clearing the status / module filters."
              action={
                canCreate ? (
                  <Button onClick={() => navigate("/reservations/new")}>
                    <Plus className="h-4 w-4" /> New Reservation
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-background text-left">
                    <th className="px-[18px] py-[14px] label-eyebrow">Pet</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Owner</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Reservation</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Service</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Start</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">End</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Suite</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Status</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r: any) => (
                    <tr key={r.id} className="border-t border-border-subtle hover:bg-background">
                      <td className="px-[18px] py-[14px]">
                        <PetCell
                          pets={toArray((r as any).reservation_pets).map((rp: any) => rp.pets)}
                          linkTo={`/reservations/${r.id}`}
                        />
                      </td>
                      <td className="px-[18px] py-[14px]">
                        {r.owners ? (
                          <Link
                            to={`/owners/${r.primary_owner_id}`}
                            className="block hover:text-primary"
                          >
                            <OwnerCell owner={r.owners} />
                          </Link>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-[18px] py-[14px] text-text-secondary">
                        {reservationLabel(r.services)}
                      </td>
                      <td className="px-[18px] py-[14px] text-text-secondary">
                        {serviceLabel(r.services)}
                      </td>
                      <td className="px-[18px] py-[14px] text-text-secondary whitespace-nowrap">
                        {formatDayTime(effectiveStart(r))}
                      </td>
                      <td className="px-[18px] py-[14px] text-text-secondary whitespace-nowrap">
                        {formatDayTime(effectiveEnd(r))}
                      </td>
                      <td className="px-[18px] py-[14px] text-text-secondary">
                        {r.suites?.name ?? "—"}
                      </td>
                      <td className="px-[18px] py-[14px]">
                        <ReservationStatusBadge status={r.status} />
                      </td>
                      <td className="px-[18px] py-[14px]">
                        <span className="inline-flex items-center rounded-pill border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
                          {r.source === "owner_self_serve" ? "Owner" : "Staff"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && searchTerm && (
                    <tr>
                      <td colSpan={9} className="px-[18px] py-12 text-center text-sm text-text-secondary">
                        No matches on this page. Try widening the filters or clear the search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-border-subtle px-4 py-3 text-xs text-text-secondary">
              <span>
                {data!.count} reservation{data!.count === 1 ? "" : "s"}
                {searchTerm && visibleRows.length !== data!.rows.length && (
                  <span className="ml-2 text-text-tertiary">
                    · {visibleRows.length} match{visibleRows.length === 1 ? "" : "es"} on this page
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span>Page {page + 1} of {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function ReservationsList() {
  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <ReservationsListSection />
      </div>
    </PortalLayout>
  );
}
