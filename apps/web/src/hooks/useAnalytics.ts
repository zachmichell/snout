import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import {
  DateRange,
  dayKey,
  eachDayInRange,
  getPreviousRange,
  pctChange,
  weekdayKey,
  WEEKDAY_ORDER,
} from "@/lib/analytics";

type Reservation = {
  id: string;
  status: string;
  start_at: string;
  service_id: string | null;
  primary_owner_id: string | null;
  created_at: string;
};

type Service = { id: string; name: string; module: string };
type Pet = { id: string; created_at: string };

type Invoice = {
  id: string;
  status: string;
  total_cents: number;
  paid_at: string | null;
  issued_at: string | null;
  due_at: string | null;
  invoice_number: string | null;
  owner_id: string;
  created_at: string;
};

async function fetchReservations(orgId: string, from: Date, to: Date, locationId: string | null) {
  let q = supabase
    .from("reservations")
    .select("id,status,start_at,service_id,primary_owner_id,created_at,checked_in_at,deleted_at")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .gte("start_at", from.toISOString())
    .lte("start_at", to.toISOString())
    .limit(5000);
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as (Reservation & { checked_in_at: string | null })[];
}

async function fetchInvoicesPeriod(orgId: string, from: Date, to: Date, locationId: string | null) {
  let q = supabase
    .from("invoices")
    .select("id,status,total_cents,paid_at,issued_at,due_at,invoice_number,owner_id,created_at")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .limit(5000);
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Invoice[];
}

export function useAnalytics(range: DateRange, locationId: string | null = null) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const prev = getPreviousRange(range);

  return useQuery({
    enabled: !!orgId,
    staleTime: 60_000,
    queryKey: [
      "analytics",
      orgId,
      range.from.toISOString(),
      range.to.toISOString(),
      locationId,
    ],
    queryFn: async () => {
      if (!orgId) throw new Error("no org");

      const outstandingQ = supabase
        .from("invoices")
        .select("id,status,total_cents,due_at,invoice_number,owner_id,balance_due_cents")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .in("status", ["sent", "overdue"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(10);
      const playgroupsQ = supabase
        .from("playgroups")
        .select("id,capacity")
        .eq("organization_id", orgId)
        .eq("active", true)
        .is("deleted_at", null);
      const kennelRunsQ = supabase
        .from("kennel_runs")
        .select("id,capacity")
        .eq("organization_id", orgId)
        .eq("active", true)
        .is("deleted_at", null);
      const servicesQ = supabase
        .from("services")
        .select("id,name,module")
        .eq("organization_id", orgId)
        .is("deleted_at", null);

      const [
        reservationsRes,
        prevReservationsRes,
        invoicesRes,
        prevInvoicesRes,
        outstandingRes,
        servicesRes,
        playgroupsRes,
        kennelRunsRes,
        kennelAssignmentsRes,
        newPetsRes,
      ] = await Promise.all([
        fetchReservations(orgId, range.from, range.to, locationId),
        fetchReservations(orgId, prev.from, prev.to, locationId),
        fetchInvoicesPeriod(orgId, range.from, range.to, locationId),
        fetchInvoicesPeriod(orgId, prev.from, prev.to, locationId),
        locationId ? outstandingQ.eq("location_id", locationId) : outstandingQ,
        servicesQ,
        locationId ? playgroupsQ.eq("location_id", locationId) : playgroupsQ,
        locationId ? kennelRunsQ.eq("location_id", locationId) : kennelRunsQ,
        supabase
          .from("kennel_run_assignments")
          .select("id,kennel_run_id,removed_at")
          .eq("organization_id", orgId)
          .is("removed_at", null),
        supabase
          .from("pets")
          .select("id,created_at")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .gte("created_at", range.from.toISOString())
          .lte("created_at", range.to.toISOString()),
      ]);

      const services = (servicesRes.data ?? []) as Service[];
      const serviceMap = new Map(services.map((s) => [s.id, s]));
      const playgroups = (playgroupsRes.data ?? []) as { id: string; capacity: number | null }[];
      const kennelRuns = (kennelRunsRes.data ?? []) as { id: string; capacity: number }[];
      const kennelAssignments = (kennelAssignmentsRes.data ?? []) as { kennel_run_id: string }[];
      const newPets = (newPetsRes.data ?? []) as Pet[];

      const reservations = reservationsRes;
      const prevReservations = prevReservationsRes;
      const invoices = invoicesRes;
      const prevInvoices = prevInvoicesRes;

      // ---------- KPI: Total Reservations
      const valid = reservations.filter((r) => r.status !== "cancelled" && r.status !== "no_show");
      const prevValid = prevReservations.filter((r) => r.status !== "cancelled" && r.status !== "no_show");
      const moduleBreakdown = { daycare: 0, boarding: 0 };
      for (const r of valid) {
        const m = r.service_id ? serviceMap.get(r.service_id)?.module : null;
        if (m === "daycare") moduleBreakdown.daycare++;
        else if (m === "boarding") moduleBreakdown.boarding++;
      }

      // ---------- KPI: Revenue (paid + partial in period, by created_at)
      const revenuePeriod = invoices
        .filter((i) => i.status === "paid" || i.status === "partial")
        .reduce((sum, i) => sum + (i.total_cents ?? 0), 0);
      const revenuePrev = prevInvoices
        .filter((i) => i.status === "paid" || i.status === "partial")
        .reduce((sum, i) => sum + (i.total_cents ?? 0), 0);

      // ---------- Reservations by day series
      const days = eachDayInRange(range);
      const dayBuckets = new Map(
        days.map((d) => [d.key, { key: d.key, label: d.label, daycare: 0, boarding: 0, total: 0 }]),
      );
      for (const r of valid) {
        const k = dayKey(new Date(r.start_at));
        const bucket = dayBuckets.get(k);
        if (!bucket) continue;
        const m = r.service_id ? serviceMap.get(r.service_id)?.module : null;
        if (m === "daycare") bucket.daycare++;
        else if (m === "boarding") bucket.boarding++;
        bucket.total++;
      }
      const reservationSeries = Array.from(dayBuckets.values());

      // ---------- Revenue by day series
      const revenueBuckets = new Map(
        days.map((d) => [d.key, { key: d.key, label: d.label, revenue: 0 }]),
      );
      for (const i of invoices) {
        if (i.status !== "paid" && i.status !== "partial") continue;
        const k = dayKey(new Date(i.paid_at ?? i.issued_at ?? i.created_at));
        const b = revenueBuckets.get(k);
        if (b) b.revenue += (i.total_cents ?? 0) / 100;
      }
      const revenueSeries = Array.from(revenueBuckets.values());

      // ---------- Check-ins by weekday (avg per occurring weekday in range)
      const weekdayCounts: Record<string, number> = Object.fromEntries(WEEKDAY_ORDER.map((w) => [w, 0]));
      const weekdayOccurrences: Record<string, number> = Object.fromEntries(WEEKDAY_ORDER.map((w) => [w, 0]));
      for (const d of days) {
        weekdayOccurrences[weekdayKey(d.date)]++;
      }
      for (const r of reservations) {
        if (!r.checked_in_at) continue;
        const wk = weekdayKey(new Date(r.checked_in_at));
        weekdayCounts[wk] = (weekdayCounts[wk] ?? 0) + 1;
      }
      const weekdaySeries = WEEKDAY_ORDER.map((w) => ({
        day: w,
        avg: weekdayOccurrences[w] > 0 ? weekdayCounts[w] / weekdayOccurrences[w] : 0,
      }));

      // ---------- Top services
      const svcCounts = new Map<string, number>();
      for (const r of valid) {
        if (!r.service_id) continue;
        svcCounts.set(r.service_id, (svcCounts.get(r.service_id) ?? 0) + 1);
      }
      const totalSvc = Array.from(svcCounts.values()).reduce((a, b) => a + b, 0);
      const topServices = Array.from(svcCounts.entries())
        .map(([id, count]) => ({
          id,
          name: serviceMap.get(id)?.name ?? "Unknown",
          count,
          pct: totalSvc > 0 ? (count / totalSvc) * 100 : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // ---------- Active pets / new pets
      const uniquePetIds = new Set<string>();
      const reservationIds = valid.map((r) => r.id);
      if (reservationIds.length > 0) {
        const { data: rps } = await supabase
          .from("reservation_pets")
          .select("pet_id,reservation_id")
          .in("reservation_id", reservationIds);
        for (const rp of rps ?? []) uniquePetIds.add(rp.pet_id as string);
      }
      const activePets = uniquePetIds.size;

      // ---------- Occupancy (today snapshot)
      const todayStr = dayKey(new Date());
      const checkedInToday = reservations.filter((r) => {
        if (r.status !== "checked_in") return false;
        return r.checked_in_at ? dayKey(new Date(r.checked_in_at)) <= todayStr : false;
      });
      // For occupancy we should count *currently* checked in pets, regardless of date filter.
      const { data: currentlyChecked } = await supabase
        .from("reservations")
        .select("id,service_id")
        .eq("organization_id", orgId)
        .eq("status", "checked_in")
        .is("deleted_at", null)
        .limit(2000);
      let daycarePets = 0;
      const boardingReservationIds: string[] = [];
      for (const r of currentlyChecked ?? []) {
        const m = r.service_id ? serviceMap.get(r.service_id)?.module : null;
        if (m === "daycare") daycarePets++;
        else if (m === "boarding") boardingReservationIds.push(r.id as string);
      }
      // Daycare capacity = sum of playgroup capacities
      const daycareCapacity = playgroups.reduce((s, p) => s + (p.capacity ?? 0), 0);
      const daycareOccupancy = daycareCapacity > 0 ? (daycarePets / daycareCapacity) * 100 : 0;
      // Boarding occupancy = occupied runs / active runs
      const occupiedRunIds = new Set(kennelAssignments.map((a) => a.kennel_run_id));
      const occupiedRuns = kennelRuns.filter((k) => occupiedRunIds.has(k.id)).length;
      const totalRuns = kennelRuns.length;
      const boardingOccupancy = totalRuns > 0 ? (occupiedRuns / totalRuns) * 100 : 0;

      // ---------- No-show & cancellation
      const noShows = reservations.filter((r) => r.status === "no_show").length;
      const cancels = reservations.filter((r) => r.status === "cancelled").length;
      const totalAll = reservations.length;
      const noShowPct = totalAll > 0 ? (noShows / totalAll) * 100 : 0;
      const cancelPct = totalAll > 0 ? (cancels / totalAll) * 100 : 0;

      // ---------- Recent activity (last 10 reservations by created_at, in range)
      const recent = [...reservations].sort((a, b) => (b.created_at > a.created_at ? 1 : -1)).slice(0, 10);
      const recentOwnerIds = Array.from(new Set(recent.map((r) => r.primary_owner_id).filter(Boolean))) as string[];
      const recentResIds = recent.map((r) => r.id);
      const [ownersRes, resPetsRes] = await Promise.all([
        recentOwnerIds.length
          ? supabase.from("owners").select("id,first_name,last_name").in("id", recentOwnerIds)
          : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
        recentResIds.length
          ? supabase.from("reservation_pets").select("reservation_id,pet_id").in("reservation_id", recentResIds)
          : Promise.resolve({ data: [] as { reservation_id: string; pet_id: string }[] }),
      ]);
      const ownerMap = new Map((ownersRes.data ?? []).map((o) => [o.id, `${o.first_name} ${o.last_name}`]));
      const petIdsForRecent = Array.from(new Set((resPetsRes.data ?? []).map((rp) => rp.pet_id)));
      const { data: petRows } = petIdsForRecent.length
        ? await supabase.from("pets").select("id,name").in("id", petIdsForRecent)
        : { data: [] as { id: string; name: string }[] };
      const petMap = new Map((petRows ?? []).map((p) => [p.id, p.name]));
      const resPetsByRes = new Map<string, string[]>();
      for (const rp of resPetsRes.data ?? []) {
        const arr = resPetsByRes.get(rp.reservation_id) ?? [];
        arr.push(petMap.get(rp.pet_id) ?? "Pet");
        resPetsByRes.set(rp.reservation_id, arr);
      }
      const recentActivity = recent.map((r) => ({
        id: r.id,
        date: r.start_at,
        pets: (resPetsByRes.get(r.id) ?? []).join(", ") || "—",
        owner: r.primary_owner_id ? ownerMap.get(r.primary_owner_id) ?? "—" : "—",
        service: r.service_id ? serviceMap.get(r.service_id)?.name ?? "—" : "—",
        status: r.status,
      }));

      // ---------- Outstanding invoices with owner names
      const outstanding = (outstandingRes.data ?? []) as {
        id: string;
        status: string;
        total_cents: number;
        due_at: string | null;
        invoice_number: string | null;
        owner_id: string;
        balance_due_cents: number | null;
      }[];
      const outstandingOwnerIds = Array.from(new Set(outstanding.map((o) => o.owner_id)));
      const { data: outOwners } = outstandingOwnerIds.length
        ? await supabase.from("owners").select("id,first_name,last_name").in("id", outstandingOwnerIds)
        : { data: [] as { id: string; first_name: string; last_name: string }[] };
      const outOwnerMap = new Map((outOwners ?? []).map((o) => [o.id, `${o.first_name} ${o.last_name}`]));
      const outstandingInvoices = outstanding.map((o) => ({
        ...o,
        ownerName: outOwnerMap.get(o.owner_id) ?? "—",
      }));

      return {
        totals: {
          reservations: valid.length,
          reservationsPrev: prevValid.length,
          reservationsDelta: pctChange(valid.length, prevValid.length),
          moduleBreakdown,
          revenue: revenuePeriod,
          revenuePrev,
          revenueDelta: pctChange(revenuePeriod, revenuePrev),
          activePets,
          newPets: newPets.length,
          daycareOccupancy,
          boardingOccupancy,
          daycarePets,
          daycareCapacity,
          occupiedRuns,
          totalRuns,
          noShows,
          noShowPct,
          cancels,
          cancelPct,
        },
        reservationSeries,
        revenueSeries,
        weekdaySeries,
        topServices,
        recentActivity,
        outstandingInvoices,
      };
    },
  });
}
