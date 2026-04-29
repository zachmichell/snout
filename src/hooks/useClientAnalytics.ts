import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { DateRange, dayKey, eachDayInRange } from "@/lib/analytics";

export type ClientStats = {
  newClients: number;
  newClientsSeries: { key: string; label: string; count: number }[];
  retention30: number; // percentage
  retention60: number;
  retention90: number;
  topClients: { id: string; name: string; revenue: number; visits: number }[];
  avgVisits: number;
  bySource: { source: string; count: number }[];
};

export function useClientAnalytics(range: DateRange, locationId: string | null = null) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  return useQuery<ClientStats>({
    enabled: !!orgId,
    staleTime: 60_000,
    queryKey: ["client-analytics", orgId, range.from.toISOString(), range.to.toISOString(), locationId],
    queryFn: async () => {
      if (!orgId) throw new Error("no org");

      const [ownersRes, invoicesRes, reservationsRes, retentionRes] = await Promise.all([
        supabase
          .from("owners")
          .select("id, first_name, last_name, created_at, referral_source")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .gte("created_at", range.from.toISOString())
          .lte("created_at", range.to.toISOString())
          .limit(2000),
        supabase
          .from("invoices")
          .select("id, owner_id, total_cents, status, created_at, paid_at")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .gte("created_at", range.from.toISOString())
          .lte("created_at", range.to.toISOString())
          .limit(5000),
        supabase
          .from("reservations")
          .select("id, primary_owner_id, start_at, status")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .gte("start_at", range.from.toISOString())
          .lte("start_at", range.to.toISOString())
          .limit(5000),
        // Retention is computed server-side via client_retention_stats RPC
        // to avoid shipping up to 15k rows of prior owners + reservations.
        supabase.rpc("client_retention_stats", {
          _org_id: orgId,
          _range_from: range.from.toISOString(),
        }),
      ]);

      const newOwners = (ownersRes.data ?? []) as Array<{ id: string; first_name: string; last_name: string; created_at: string; referral_source: string | null }>;
      const invoices = (invoicesRes.data ?? []) as Array<{ id: string; owner_id: string; total_cents: number; status: string; created_at: string }>;
      const reservations = (reservationsRes.data ?? []) as Array<{ id: string; primary_owner_id: string | null; start_at: string; status: string }>;
      const retentionRow = Array.isArray(retentionRes.data) ? retentionRes.data[0] : null;
      const retention30 = Number(retentionRow?.retention30 ?? 0);
      const retention60 = Number(retentionRow?.retention60 ?? 0);
      const retention90 = Number(retentionRow?.retention90 ?? 0);

      // New clients series
      const days = eachDayInRange(range);
      const buckets = new Map(days.map((d) => [d.key, { key: d.key, label: d.label, count: 0 }]));
      for (const o of newOwners) {
        const k = dayKey(new Date(o.created_at));
        const b = buckets.get(k);
        if (b) b.count += 1;
      }
      const newClientsSeries = Array.from(buckets.values());

      // Retention (retention30/60/90) is set above from client_retention_stats RPC.

      // Top clients by revenue (in range). Fetch only the names we
      // actually render (at most 10) rather than the full owners list —
      // the prior implementation capped at 5000 and silently truncated
      // names beyond that on large orgs.
      const revByOwner = new Map<string, number>();
      for (const inv of invoices) {
        if (inv.status !== "paid" && inv.status !== "partial") continue;
        revByOwner.set(inv.owner_id, (revByOwner.get(inv.owner_id) ?? 0) + (inv.total_cents ?? 0));
      }
      const visitsByOwnerRange = new Map<string, number>();
      for (const r of reservations) {
        if (!r.primary_owner_id) continue;
        if (r.status === "cancelled" || r.status === "no_show") continue;
        visitsByOwnerRange.set(r.primary_owner_id, (visitsByOwnerRange.get(r.primary_owner_id) ?? 0) + 1);
      }
      const topRanked = Array.from(revByOwner.entries())
        .map(([id, revenue]) => ({
          id,
          revenue,
          visits: visitsByOwnerRange.get(id) ?? 0,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

      let ownerNameMap = new Map<string, string>();
      if (topRanked.length > 0) {
        const { data: topOwners } = await supabase
          .from("owners")
          .select("id, first_name, last_name")
          .in("id", topRanked.map((t) => t.id));
        ownerNameMap = new Map(
          (topOwners ?? []).map((o) => [o.id, `${o.first_name} ${o.last_name}`.trim()]),
        );
      }
      const topClients = topRanked.map((t) => ({
        ...t,
        name: ownerNameMap.get(t.id) ?? "—",
      }));

      const totalVisits = Array.from(visitsByOwnerRange.values()).reduce((s, v) => s + v, 0);
      const uniqueVisitors = visitsByOwnerRange.size || 1;
      const avgVisits = totalVisits / uniqueVisitors;

      // Acquisition by source (across new owners in range)
      const sourceMap = new Map<string, number>();
      for (const o of newOwners) {
        const src = (o.referral_source ?? "Unknown").trim() || "Unknown";
        sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
      }
      const bySource = Array.from(sourceMap.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count);

      return {
        newClients: newOwners.length,
        newClientsSeries,
        retention30,
        retention60,
        retention90,
        topClients,
        avgVisits,
        bySource,
      };
    },
  });
}
