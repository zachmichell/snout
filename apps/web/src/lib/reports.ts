// Report aggregation helpers. All money in cents.
//
// Multi-location: every fetch function takes an optional `locationId`
// argument. When set, results scope to that location; when null/undefined
// (the default), reports remain org-wide. The Reports page passes the
// global LocationContext value, so toggling the location selector in the
// header re-runs every tab against the new scope.
//
// Tables that already carry location_id (invoices, reservations,
// owner_subscriptions, incidents) filter directly. Tables without it
// (payments, deposits, owners, pets, vaccinations) either filter via
// the parent that does carry location, or stay org-wide where the
// concept doesn't fit (e.g., a customer record exists across locations).
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type DateRange = { from: Date; to: Date };
export type LocationFilter = string | null | undefined;
export type ReportClient = SupabaseClient<Database>;

export const presets = {
  last7: () => ({ from: daysAgo(7), to: new Date() }),
  last30: () => ({ from: daysAgo(30), to: new Date() }),
  last90: () => ({ from: daysAgo(90), to: new Date() }),
  thisMonth: () => {
    const now = new Date();
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  },
  ytd: () => {
    const now = new Date();
    return { from: new Date(now.getFullYear(), 0, 1), to: now };
  },
};

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export type Bucket = "day" | "week" | "month";

export function bucketKey(date: Date, bucket: Bucket): string {
  const d = new Date(date);
  if (bucket === "day") return d.toISOString().slice(0, 10);
  if (bucket === "week") {
    const day = d.getDay();
    const diff = d.getDate() - day;
    const w = new Date(d.setDate(diff));
    return w.toISOString().slice(0, 10);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ===== FINANCIAL =====

export async function fetchRevenueByDate(orgId: string, range: DateRange, bucket: Bucket, locationId?: LocationFilter, client: ReportClient = supabase) {
  let q = client
    .from("invoices")
    .select("total_cents, paid_at, status")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .gte("paid_at", range.from.toISOString())
    .lte("paid_at", range.to.toISOString())
    .not("paid_at", "is", null);
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  const map = new Map<string, { period: string; revenue: number; count: number }>();
  (data ?? []).forEach((inv) => {
    if (!inv.paid_at) return;
    const k = bucketKey(new Date(inv.paid_at), bucket);
    const cur = map.get(k) ?? { period: k, revenue: 0, count: 0 };
    cur.revenue += inv.total_cents ?? 0;
    cur.count += 1;
    map.set(k, cur);
  });
  return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
}

export async function fetchEndOfDay(orgId: string, day: Date, locationId?: LocationFilter, client: ReportClient = supabase) {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  let invQ = client
    .from("invoices")
    .select("id, total_cents, tax_cents, status, paid_at, location_id")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .gte("paid_at", start.toISOString())
    .lte("paid_at", end.toISOString());
  if (locationId) invQ = invQ.eq("location_id", locationId);
  const { data: invoices } = await invQ;
  // Payments don't carry location_id, so we filter via the invoice id
  // set we just resolved (preserving the location scope upstream).
  const invIds = (invoices ?? []).map((i: { id: string }) => i.id);
  let payQ = client
    .from("payments")
    .select("amount_cents, status, processed_at, method, invoice_id")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .gte("processed_at", start.toISOString())
    .lte("processed_at", end.toISOString());
  if (locationId) {
    payQ = invIds.length === 0 ? payQ.eq("invoice_id", "00000000-0000-0000-0000-000000000000") : payQ.in("invoice_id", invIds);
  }
  const { data: payments } = await payQ;
  const revenue = (invoices ?? []).reduce((s, i) => s + (i.total_cents ?? 0), 0);
  const tax = (invoices ?? []).reduce((s, i) => s + (i.tax_cents ?? 0), 0);
  const transactions = (payments ?? []).filter((p) => p.status === "succeeded").length;
  const refunds = (payments ?? []).filter((p) => p.status === "refunded").reduce((s, p) => s + (p.amount_cents ?? 0), 0);
  return { revenue, tax, transactions, refunds, invoiceCount: invoices?.length ?? 0 };
}

export async function fetchSalesTax(orgId: string, range: DateRange, bucket: Bucket, locationId?: LocationFilter) {
  let q = supabase
    .from("invoices")
    .select("tax_cents, paid_at")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .gte("paid_at", range.from.toISOString())
    .lte("paid_at", range.to.toISOString())
    .not("paid_at", "is", null);
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  const map = new Map<string, { period: string; tax: number }>();
  (data ?? []).forEach((inv) => {
    if (!inv.paid_at) return;
    const k = bucketKey(new Date(inv.paid_at), bucket);
    const cur = map.get(k) ?? { period: k, tax: 0 };
    cur.tax += inv.tax_cents ?? 0;
    map.set(k, cur);
  });
  return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
}

export async function fetchOutstanding(orgId: string, locationId?: LocationFilter) {
  let q = supabase
    .from("invoices")
    .select("id, invoice_number, total_cents, amount_paid_cents, balance_due_cents, due_at, status, owner_id, owners(first_name, last_name, email)")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .in("status", ["sent", "partial", "overdue"]);
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  return (data ?? []).map((i: any) => ({
    id: i.id,
    invoice_number: i.invoice_number,
    owner: i.owners ? `${i.owners.first_name} ${i.owners.last_name}` : "—",
    email: i.owners?.email ?? "",
    total: i.total_cents ?? 0,
    paid: i.amount_paid_cents ?? 0,
    balance: i.balance_due_cents ?? (i.total_cents - (i.amount_paid_cents ?? 0)),
    due_at: i.due_at,
    status: i.status,
  }));
}

export async function fetchRefunds(orgId: string, range: DateRange, locationId?: LocationFilter) {
  let q = supabase
    .from("payments")
    .select("id, amount_cents, processed_at, method, invoice_id, invoices!inner(invoice_number, location_id, owners(first_name, last_name))")
    .eq("organization_id", orgId)
    .eq("status", "refunded")
    .is("deleted_at", null)
    .gte("processed_at", range.from.toISOString())
    .lte("processed_at", range.to.toISOString());
  if (locationId) q = q.eq("invoices.location_id", locationId);
  const { data } = await q;
  return (data ?? []).map((p: any) => ({
    id: p.id,
    amount: p.amount_cents ?? 0,
    processed_at: p.processed_at,
    method: p.method,
    invoice_number: p.invoices?.invoice_number ?? "—",
    owner: p.invoices?.owners ? `${p.invoices.owners.first_name} ${p.invoices.owners.last_name}` : "—",
  }));
}

export async function fetchDeposits(orgId: string, range: DateRange, locationId?: LocationFilter) {
  // Deposits don't carry location_id directly; they sit on a reservation.
  // When a location is selected we resolve the reservation set first and
  // narrow deposits to that subset. Org-wide otherwise.
  let reservationIds: string[] | null = null;
  if (locationId) {
    const { data: rs } = await supabase
      .from("reservations")
      .select("id")
      .eq("organization_id", orgId)
      .eq("location_id", locationId)
      .is("deleted_at", null);
    reservationIds = (rs ?? []).map((r: { id: string }) => r.id);
  }
  let q = supabase
    .from("deposits")
    .select("id, amount_cents, status, paid_at, refunded_at, forfeited_at, created_at, reservation_id, owners(first_name, last_name)")
    .eq("organization_id", orgId)
    .gte("created_at", range.from.toISOString())
    .lte("created_at", range.to.toISOString());
  if (reservationIds) {
    q = reservationIds.length === 0
      ? q.eq("reservation_id", "00000000-0000-0000-0000-000000000000")
      : q.in("reservation_id", reservationIds);
  }
  const { data } = await q;
  const rows = (data ?? []).map((d: any) => ({
    id: d.id,
    amount: d.amount_cents ?? 0,
    status: d.status,
    owner: d.owners ? `${d.owners.first_name} ${d.owners.last_name}` : "—",
    created_at: d.created_at,
    paid_at: d.paid_at,
    refunded_at: d.refunded_at,
    forfeited_at: d.forfeited_at,
  }));
  const totals = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + r.amount;
      return acc;
    },
    {} as Record<string, number>,
  );
  return { rows, totals };
}

export async function fetchPackageSales(orgId: string, range: DateRange, locationId?: LocationFilter) {
  let q = supabase
    .from("owner_subscriptions")
    .select("id, purchased_at, status, package_id")
    .eq("organization_id", orgId)
    .gte("purchased_at", range.from.toISOString())
    .lte("purchased_at", range.to.toISOString());
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  const map = new Map<string, { package_id: string; count: number }>();
  (data ?? []).forEach((s) => {
    const cur = map.get(s.package_id) ?? { package_id: s.package_id, count: 0 };
    cur.count += 1;
    map.set(s.package_id, cur);
  });
  return { rows: data ?? [], grouped: Array.from(map.values()) };
}

// ===== RESERVATIONS =====

export async function fetchReservations(orgId: string, range: DateRange, locationId?: LocationFilter) {
  let q = supabase
    .from("reservations")
    .select("id, start_at, end_at, status, service_id, primary_owner_id, services(name, module), owners:primary_owner_id(first_name, last_name)")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .gte("start_at", range.from.toISOString())
    .lte("start_at", range.to.toISOString());
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  return data ?? [];
}

export async function fetchOccupancyByDay(orgId: string, range: DateRange, locationId?: LocationFilter) {
  const reservations = await fetchReservations(orgId, range, locationId);
  const map = new Map<string, number>();
  reservations.forEach((r: any) => {
    if (!r.start_at) return;
    if (["cancelled", "no_show"].includes(r.status)) return;
    const k = bucketKey(new Date(r.start_at), "day");
    map.set(k, (map.get(k) ?? 0) + 1);
  });
  return Array.from(map.entries()).map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day));
}

export async function fetchNoShows(orgId: string, range: DateRange, locationId?: LocationFilter) {
  let q = supabase
    .from("reservations")
    .select("id, start_at, primary_owner_id, owners:primary_owner_id(first_name, last_name, email)")
    .eq("organization_id", orgId)
    .eq("status", "no_show")
    .is("deleted_at", null)
    .gte("start_at", range.from.toISOString())
    .lte("start_at", range.to.toISOString());
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  const byOwner = new Map<string, { owner: string; email: string; count: number }>();
  (data ?? []).forEach((r: any) => {
    const key = r.primary_owner_id ?? "unknown";
    const cur = byOwner.get(key) ?? {
      owner: r.owners ? `${r.owners.first_name} ${r.owners.last_name}` : "—",
      email: r.owners?.email ?? "",
      count: 0,
    };
    cur.count += 1;
    byOwner.set(key, cur);
  });
  return { rows: data ?? [], byOwner: Array.from(byOwner.values()).sort((a, b) => b.count - a.count) };
}

export async function fetchCancellations(orgId: string, range: DateRange, locationId?: LocationFilter) {
  let q = supabase
    .from("reservations")
    .select("id, start_at, cancelled_at, cancelled_reason, owners:primary_owner_id(first_name, last_name)")
    .eq("organization_id", orgId)
    .eq("status", "cancelled")
    .is("deleted_at", null)
    .gte("start_at", range.from.toISOString())
    .lte("start_at", range.to.toISOString());
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  const reasonMap = new Map<string, number>();
  (data ?? []).forEach((r: any) => {
    const reason = r.cancelled_reason || "Unspecified";
    reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
  });
  return { rows: data ?? [], reasons: Array.from(reasonMap.entries()).map(([reason, count]) => ({ reason, count })) };
}

export async function fetchServiceTypeComparison(orgId: string, range: DateRange, locationId?: LocationFilter) {
  const reservations = await fetchReservations(orgId, range, locationId);
  const map = new Map<string, { service: string; count: number; revenue: number }>();
  reservations.forEach((r: any) => {
    const name = r.services?.name ?? "Unknown";
    const cur = map.get(name) ?? { service: name, count: 0, revenue: 0 };
    cur.count += 1;
    map.set(name, cur);
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export async function fetchFutureReservations(orgId: string, locationId?: LocationFilter) {
  const now = new Date();
  const future = new Date();
  future.setMonth(future.getMonth() + 3);
  let q = supabase
    .from("reservations")
    .select("id, start_at, status")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .gte("start_at", now.toISOString())
    .lte("start_at", future.toISOString())
    .in("status", ["requested", "confirmed"]);
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  const byWeek = new Map<string, number>();
  (data ?? []).forEach((r) => {
    if (!r.start_at) return;
    const k = bucketKey(new Date(r.start_at), "week");
    byWeek.set(k, (byWeek.get(k) ?? 0) + 1);
  });
  return Array.from(byWeek.entries()).map(([week, count]) => ({ week, count })).sort((a, b) => a.week.localeCompare(b.week));
}

export async function fetchStandingReservations(orgId: string, locationId?: LocationFilter) {
  let q = supabase
    .from("recurring_reservation_groups")
    .select("id, start_date, end_date, days_of_week, status, owner_id, pet_ids, owners(first_name, last_name)")
    .eq("organization_id", orgId)
    .eq("status", "active");
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  return (data ?? []) as any[];
}

export async function fetchAvgPetsPerWeek(orgId: string, range: DateRange, locationId?: LocationFilter) {
  let q = supabase
    .from("reservation_pets")
    .select("pet_id, reservations!inner(start_at, organization_id, deleted_at, location_id)")
    .eq("reservations.organization_id", orgId)
    .is("reservations.deleted_at", null)
    .gte("reservations.start_at", range.from.toISOString())
    .lte("reservations.start_at", range.to.toISOString());
  if (locationId) q = q.eq("reservations.location_id", locationId);
  const { data } = await q;
  const byWeek = new Map<string, Set<string>>();
  ((data ?? []) as any[]).forEach((rp: any) => {
    const start = rp.reservations?.start_at;
    if (!start) return;
    const k = bucketKey(new Date(start), "week");
    const set = byWeek.get(k) ?? new Set<string>();
    set.add(rp.pet_id);
    byWeek.set(k, set);
  });
  return Array.from(byWeek.entries())
    .map(([week, set]) => ({ week, pets: set.size }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

// ===== OWNERS =====

export async function fetchNewCustomers(orgId: string, range: DateRange, bucket: Bucket, locationId?: LocationFilter) {
  // Owners are org-wide records (a customer can use any location), so when a
  // location is selected we narrow to owners whose first reservation landed
  // at that location instead of filtering owners directly.
  let ownerIdScope: string[] | null = null;
  if (locationId) {
    const { data: rs } = await supabase
      .from("reservations")
      .select("primary_owner_id")
      .eq("organization_id", orgId)
      .eq("location_id", locationId)
      .is("deleted_at", null);
    ownerIdScope = Array.from(new Set((rs ?? []).map((r: { primary_owner_id: string | null }) => r.primary_owner_id).filter((x): x is string => !!x)));
  }
  let q = supabase
    .from("owners")
    .select("id, first_name, last_name, email, created_at")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .gte("created_at", range.from.toISOString())
    .lte("created_at", range.to.toISOString());
  if (ownerIdScope) {
    q = ownerIdScope.length === 0
      ? q.eq("id", "00000000-0000-0000-0000-000000000000")
      : q.in("id", ownerIdScope);
  }
  const { data } = await q;
  const map = new Map<string, number>();
  (data ?? []).forEach((o) => {
    const k = bucketKey(new Date(o.created_at), bucket);
    map.set(k, (map.get(k) ?? 0) + 1);
  });
  return {
    rows: data ?? [],
    chart: Array.from(map.entries()).map(([period, count]) => ({ period, count })).sort((a, b) => a.period.localeCompare(b.period)),
  };
}

export async function fetchActiveSubscriptions(orgId: string, locationId?: LocationFilter) {
  let q = supabase
    .from("owner_subscriptions")
    .select("id, package_id, remaining_credits, purchased_at, next_billing_date, owners(first_name, last_name, email)")
    .eq("organization_id", orgId)
    .eq("status", "active");
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  return (data ?? []) as any[];
}

export async function fetchOwnerSpend(orgId: string, range: DateRange, locationId?: LocationFilter) {
  let q = supabase
    .from("invoices")
    .select("owner_id, total_cents, paid_at, owners(first_name, last_name, email)")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .not("paid_at", "is", null)
    .gte("paid_at", range.from.toISOString())
    .lte("paid_at", range.to.toISOString());
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  const map = new Map<string, { owner: string; email: string; total: number; visits: number }>();
  (data ?? []).forEach((inv: any) => {
    const cur = map.get(inv.owner_id) ?? {
      owner: inv.owners ? `${inv.owners.first_name} ${inv.owners.last_name}` : "—",
      email: inv.owners?.email ?? "",
      total: 0,
      visits: 0,
    };
    cur.total += inv.total_cents ?? 0;
    cur.visits += 1;
    map.set(inv.owner_id, cur);
  });
  return Array.from(map.values())
    .map((r) => ({ ...r, avg: r.visits > 0 ? Math.round(r.total / r.visits) : 0 }))
    .sort((a, b) => b.total - a.total);
}

// ===== PETS =====

export async function fetchVaccineExpirations(orgId: string) {
  const today = new Date();
  const in90 = new Date();
  in90.setDate(in90.getDate() + 90);
  const { data } = await supabase
    .from("vaccinations")
    .select("id, vaccine_type, expires_on, pet_id, pets(name)")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .not("expires_on", "is", null)
    .gte("expires_on", today.toISOString().slice(0, 10))
    .lte("expires_on", in90.toISOString().slice(0, 10));
  const rows = ((data ?? []) as any[]).map((v: any) => {
    const exp = new Date(v.expires_on);
    const days = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    let bucket: "30" | "60" | "90" = "90";
    if (days <= 30) bucket = "30";
    else if (days <= 60) bucket = "60";
    return { id: v.id, pet: v.pets?.name ?? "—", vaccine: v.vaccine_type, expires_on: v.expires_on, days, bucket };
  });
  return rows.sort((a, b) => a.days - b.days);
}

export async function fetchBirthdaysThisMonth(orgId: string) {
  const { data } = await supabase
    .from("pets")
    .select("id, name, date_of_birth, species, breed")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .not("date_of_birth", "is", null);
  const month = new Date().getMonth() + 1;
  return (data ?? [])
    .filter((p) => p.date_of_birth && new Date(p.date_of_birth).getMonth() + 1 === month)
    .sort((a, b) => new Date(a.date_of_birth!).getDate() - new Date(b.date_of_birth!).getDate());
}

export async function fetchIncidentReport(orgId: string, range: DateRange, locationId?: LocationFilter) {
  let q = supabase
    .from("incidents")
    .select("id, incident_type, severity, incident_at, description, owner_notified")
    .eq("organization_id", orgId)
    .gte("incident_at", range.from.toISOString())
    .lte("incident_at", range.to.toISOString())
    .order("incident_at", { ascending: false });
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  const sevMap = new Map<string, number>();
  (data ?? []).forEach((i) => sevMap.set(i.severity, (sevMap.get(i.severity) ?? 0) + 1));
  return { rows: data ?? [], bySeverity: Array.from(sevMap.entries()).map(([severity, count]) => ({ severity, count })) };
}
