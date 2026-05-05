// Hooks for triggering QuickBooks Online entity syncs and reading the
// current mapping state. Read-side returns counts + per-state breakdown
// so the QuickBooksTab can render quick "X synced, Y failed" badges
// without loading the full mapping list.
import { useCallback, useRef, useState } from "react";
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
  has_more: boolean;
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

// =============================================================================
// "Sync all" loop driver. Calls a single-batch sync function in a loop until
// the server reports has_more === false or the user cancels. Surfaces running
// totals so the UI can show "Syncing 1,200 / 8,463..." in real time.
// =============================================================================

export type SyncAllProgress = {
  running: boolean;
  batches: number;
  totalProcessed: number;
  totalCreated: number;
  totalUpdated: number;
  totalUnchanged: number;
  totalFailed: number;
  lastError: string | null;
  // First few failure reasons across all batches so the operator
  // can scan them when the loop completes.
  failures: Array<{ snout_id: string; reason: string }>;
};

const initialProgress = (): SyncAllProgress => ({
  running: false,
  batches: 0,
  totalProcessed: 0,
  totalCreated: 0,
  totalUpdated: 0,
  totalUnchanged: 0,
  totalFailed: 0,
  lastError: null,
  failures: [],
});

// Tiny delay between batches so we never hammer the rate limiter even
// if a server invocation finishes faster than expected. The function
// itself paces intra-batch; this delay is just additional cushion.
const INTER_BATCH_DELAY_MS = 250;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function useSyncAllDriver(functionName: "quickbooks-sync-customers" | "quickbooks-sync-items") {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const [progress, setProgress] = useState<SyncAllProgress>(initialProgress);
  // Cancel signal lives in a ref so the loop closure always reads the
  // latest value without a re-render dance.
  const cancelRef = useRef(false);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const start = useCallback(async () => {
    if (progress.running) return;
    cancelRef.current = false;
    setProgress({ ...initialProgress(), running: true });

    let batches = 0;
    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalUnchanged = 0;
    let totalFailed = 0;
    let lastError: string | null = null;
    const failures: SyncAllProgress["failures"] = [];

    try {
      // Bounded loop. 1000 batches at 100/batch = 100k entities; well
      // beyond any operator's catalog size. The cap exists so an
      // unexpected server-side has_more=true loop bug can't run away.
      for (let i = 0; i < 1000; i++) {
        if (cancelRef.current) break;

        const { data, error } = await supabase.functions.invoke(functionName, { body: {} });
        if (error) {
          lastError = error.message ?? String(error);
          break;
        }
        const r = data as SyncResult;
        batches += 1;
        totalProcessed += r.processed;
        totalCreated += r.created;
        totalUpdated += r.updated;
        totalUnchanged += r.unchanged;
        totalFailed += r.failed;
        for (const f of r.failures ?? []) {
          if (failures.length < 50) failures.push(f);
        }

        setProgress({
          running: true,
          batches,
          totalProcessed,
          totalCreated,
          totalUpdated,
          totalUnchanged,
          totalFailed,
          lastError,
          failures,
        });

        if (!r.has_more) break;
        await wait(INTER_BATCH_DELAY_MS);
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      setProgress({
        running: false,
        batches,
        totalProcessed,
        totalCreated,
        totalUpdated,
        totalUnchanged,
        totalFailed,
        lastError,
        failures,
      });
      qc.invalidateQueries({
        queryKey: ["quickbooks-mapping-counts", membership?.organization_id],
      });
    }
  }, [functionName, progress.running, qc, membership?.organization_id]);

  return { progress, start, cancel };
}

export function useSyncAllQuickBooksCustomers() {
  return useSyncAllDriver("quickbooks-sync-customers");
}

export function useSyncAllQuickBooksItems() {
  return useSyncAllDriver("quickbooks-sync-items");
}
