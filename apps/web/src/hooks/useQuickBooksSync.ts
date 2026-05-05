// Hooks for triggering QuickBooks Online entity syncs and reading the
// current mapping state. Read-side returns counts + per-state breakdown
// so the QuickBooksTab can render quick "X synced, Y failed" badges
// without loading the full mapping list.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type SyncResult = {
  ok: boolean;
  processed: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  failures: Array<{ snout_id: string; reason: string }>;
  batch_limit: number;
  income_account?: { id: string; name: string };
};

export type SyncCounts = {
  table: string;
  total: number;
  synced: number;
  pending: number;
  failed: number;
  orphaned: number;
};

export function useQuickBooksMappingCounts() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: ["quickbooks-mapping-counts", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async (): Promise<SyncCounts[]> => {
      // Two parallel reads: total Snout entities (so we can show
      // "8/12 synced") and the per-state mapping counts. We do this
      // client-side because we don't have a Postgres view for it yet.
      // Note: with `head: true, count: "exact"`, supabase-js returns
      // the count on the top-level response, not inside `data`.
      const orgId = membership!.organization_id;
      const [ownerRes, serviceRes, { data: mappings }] = await Promise.all([
        supabase
          .from("owners")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .is("deleted_at", null),
        supabase
          .from("services")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .is("deleted_at", null),
        supabase
          .from("quickbooks_entity_mappings")
          .select("snout_table, sync_state")
          .eq("organization_id", orgId)
          .is("deleted_at", null),
      ]);

      const buckets = new Map<string, SyncCounts>([
        ["owners", emptyCounts("owners")],
        ["services", emptyCounts("services")],
      ]);

      buckets.get("owners")!.total = ownerRes.count ?? 0;
      buckets.get("services")!.total = serviceRes.count ?? 0;

      for (const m of mappings ?? []) {
        const b = buckets.get(m.snout_table as string);
        if (!b) continue;
        const state = m.sync_state as keyof SyncCounts;
        if (state === "synced" || state === "pending" || state === "failed" || state === "orphaned") {
          b[state] = (b[state] as number) + 1;
        }
      }
      return Array.from(buckets.values());
    },
  });
}

function emptyCounts(table: string): SyncCounts {
  return { table, total: 0, synced: 0, pending: 0, failed: 0, orphaned: 0 };
}

export function useSyncQuickBooksCustomers() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  return useMutation({
    mutationFn: async (): Promise<SyncResult> => {
      const { data, error } = await supabase.functions.invoke("quickbooks-sync-customers", {
        body: {},
      });
      if (error) throw error;
      return data as SyncResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quickbooks-mapping-counts", membership?.organization_id] });
    },
  });
}

export function useSyncQuickBooksItems() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  return useMutation({
    mutationFn: async (): Promise<SyncResult> => {
      const { data, error } = await supabase.functions.invoke("quickbooks-sync-items", {
        body: {},
      });
      if (error) throw error;
      return data as SyncResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quickbooks-mapping-counts", membership?.organization_id] });
    },
  });
}
