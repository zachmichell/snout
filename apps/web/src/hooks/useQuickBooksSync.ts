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
      // Single SQL aggregate via qbo_mapping_counts. Returns one row
      // per (snout_table, sync_state) plus a synthetic 'total' row per
      // table giving the source-entity count. Replaces the previous
      // client-side reduction, which capped at PostgREST's 1000-row
      // default and undercounted on big catalogs.
      const orgId = membership!.organization_id;
      const { data: rows, error } = await supabase.rpc("qbo_mapping_counts", {
        _org_id: orgId,
      });
      if (error) throw error;

      const buckets = new Map<string, SyncCounts>([
        ["owners", emptyCounts("owners")],
        ["services", emptyCounts("services")],
      ]);
      for (const r of (rows ?? []) as Array<{
        snout_table: string;
        sync_state: string;
        n: number;
      }>) {
        const b = buckets.get(r.snout_table);
        if (!b) continue;
        const state = r.sync_state;
        const n = Number(r.n);
        if (state === "total") b.total = n;
        else if (state === "synced" || state === "pending" || state === "failed" || state === "orphaned") {
          (b as unknown as Record<string, number>)[state] = n;
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

// =============================================================================
// Failed-mapping resolution surface. Lists the failed rows with their entity
// names + Intuit's failure reason, lets operators retry individuals or the
// whole set after they've fixed the underlying cause in QBO.
// =============================================================================

export type FailedMapping = {
  id: string;
  snout_table: "owners" | "services";
  snout_id: string;
  entity_name: string;
  entity_secondary: string | null; // e.g. owner email, service description
  last_error: string | null;
  last_synced_at: string | null;
  updated_at: string;
};

export function useQuickBooksFailedMappings() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: ["quickbooks-failed-mappings", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async (): Promise<FailedMapping[]> => {
      const orgId = membership!.organization_id;
      // Pull the failed mappings, then enrich with entity names. Two
      // tables (owners, services) so we partition and do two lookups.
      const { data: failures, error } = await supabase
        .from("quickbooks_entity_mappings")
        .select("id, snout_table, snout_id, last_error, last_synced_at, updated_at")
        .eq("organization_id", orgId)
        .eq("sync_state", "failed")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      if (!failures || failures.length === 0) return [];

      const ownerIds = failures
        .filter((f) => f.snout_table === "owners")
        .map((f) => f.snout_id);
      const serviceIds = failures
        .filter((f) => f.snout_table === "services")
        .map((f) => f.snout_id);

      const [ownerLookup, serviceLookup] = await Promise.all([
        ownerIds.length === 0
          ? Promise.resolve({ data: [] as Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null }> })
          : supabase
              .from("owners")
              .select("id, first_name, last_name, email")
              .in("id", ownerIds),
        serviceIds.length === 0
          ? Promise.resolve({ data: [] as Array<{ id: string; name: string; description: string | null }> })
          : supabase
              .from("services")
              .select("id, name, description")
              .in("id", serviceIds),
      ]);

      const ownerById = new Map<
        string,
        { name: string; secondary: string | null }
      >();
      for (const o of ownerLookup.data ?? []) {
        const fullName = [o.first_name, o.last_name].filter(Boolean).join(" ").trim();
        ownerById.set(o.id, {
          name: fullName || o.email || `Owner ${o.id.slice(0, 8)}`,
          secondary: o.email ?? null,
        });
      }
      const serviceById = new Map<
        string,
        { name: string; secondary: string | null }
      >();
      for (const s of serviceLookup.data ?? []) {
        serviceById.set(s.id, { name: s.name, secondary: s.description ?? null });
      }

      return failures.map((f) => {
        const lookup =
          f.snout_table === "owners"
            ? ownerById.get(f.snout_id)
            : serviceById.get(f.snout_id);
        return {
          id: f.id as string,
          snout_table: f.snout_table as "owners" | "services",
          snout_id: f.snout_id as string,
          entity_name: lookup?.name ?? `${f.snout_table} ${f.snout_id.slice(0, 8)}`,
          entity_secondary: lookup?.secondary ?? null,
          last_error: f.last_error as string | null,
          last_synced_at: f.last_synced_at as string | null,
          updated_at: f.updated_at as string,
        };
      });
    },
  });
}

/** Reset a single mapping back to pending so the next sync re-tries it. */
export function useRetryFailedMapping() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  return useMutation({
    mutationFn: async (mappingId: string) => {
      const { error } = await supabase
        .from("quickbooks_entity_mappings")
        .update({ sync_state: "pending", last_error: null })
        .eq("id", mappingId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["quickbooks-failed-mappings", membership?.organization_id],
      });
      qc.invalidateQueries({
        queryKey: ["quickbooks-mapping-counts", membership?.organization_id],
      });
    },
  });
}

/** Bulk-reset failed mappings via the qbo_reset_failed_mappings SQL helper. */
export function useResetFailedMappings() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  return useMutation({
    mutationFn: async (snoutTable?: "owners" | "services"): Promise<number> => {
      const { data, error } = await supabase.rpc("qbo_reset_failed_mappings", {
        _org_id: membership!.organization_id,
        _snout_table: snoutTable ?? null,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["quickbooks-failed-mappings", membership?.organization_id],
      });
      qc.invalidateQueries({
        queryKey: ["quickbooks-mapping-counts", membership?.organization_id],
      });
    },
  });
}
