// Reliability Batch A: surface every captured config change so an
// operator who misclicks on a Settings tab can spot it and undo. Reads
// public.config_snapshots filtered to their org, newest first, and
// invokes the restore_config_snapshot RPC on demand.
//
// The trigger that populates config_snapshots fires on UPDATE / DELETE
// of every instrumented settings table (organizations, email_settings,
// notification_settings, location_hours, surcharge_settings, plus the
// six other *_settings tables — see migration
// 20260508120000_config_snapshots.sql).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Undo2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Friendly labels for the instrumented tables. Anything not in this
// map renders the raw table name; we'd rather a less-pretty fallback
// than silently mis-attribute a row.
const TABLE_LABELS: Record<string, string> = {
  organizations: "Organization",
  email_settings: "Email settings",
  notification_settings: "Notification settings",
  location_hours: "Location hours",
  auto_reply_settings: "Auto-reply",
  capacity_settings: "Capacity",
  deposit_settings: "Deposits",
  loyalty_settings: "Loyalty",
  portal_settings: "Customer portal",
  precheck_settings: "Pre-check",
  surcharge_settings: "Surcharge",
  survey_settings: "Surveys",
};

// How long after a change the "Undo" button stays available. Beyond
// this, the change is presumed accepted; the snapshot stays in the
// table for the audit trail but the button hides to avoid stale
// reverts.
const UNDO_WINDOW_DAYS = 30;

type SnapshotRow = {
  id: string;
  organization_id: string;
  table_name: string;
  row_id: string;
  action: "update" | "delete";
  before_json: Record<string, unknown>;
  after_json: Record<string, unknown> | null;
  actor_label: string | null;
  created_at: string;
  restored_at: string | null;
};

export default function SettingsHistoryTab() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["config-snapshots", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<SnapshotRow[]> => {
      const { data, error } = await supabase
        .from("config_snapshots")
        .select(
          "id, organization_id, table_name, row_id, action, before_json, after_json, actor_label, created_at, restored_at",
        )
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as SnapshotRow[];
    },
  });

  const restore = useMutation<{ ok: boolean }, Error, string>({
    mutationFn: async (snapshotId: string) => {
      const { data, error } = await supabase.rpc("restore_config_snapshot", {
        _snapshot_id: snapshotId,
      });
      if (error) throw new Error(error.message);
      return (data ?? { ok: false }) as { ok: boolean };
    },
    onSuccess: () => {
      toast.success("Change reverted");
      qc.invalidateQueries({ queryKey: ["config-snapshots", orgId] });
    },
    onError: (e) => {
      toast.error(e.message ?? "Could not revert change");
    },
  });

  if (!orgId) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <div className="mb-1 flex items-center gap-2">
          <History className="h-4 w-4 text-text-secondary" />
          <h2 className="font-display text-base text-foreground">
            Recent settings changes
          </h2>
        </div>
        <p className="text-xs text-text-tertiary">
          Every change to your organization, email, location hours,
          surcharge, deposits, capacity, and other settings is captured
          here. Click <strong>Revert</strong> within {UNDO_WINDOW_DAYS} days
          to undo a change. Older entries are kept for the audit trail
          but can no longer be reverted from this view.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        {isLoading ? (
          <div className="px-5 py-12 text-center text-sm text-text-secondary">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center font-display text-sm text-text-secondary">
            No settings changes yet. When someone edits a settings tab,
            we'll record what changed here.
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {rows.map((r) => {
              const isExpanded = expanded === r.id;
              const summary = summarize(r);
              const ageDays = ageInDays(r.created_at);
              const undoable =
                r.restored_at == null && r.action === "update" && ageDays <= UNDO_WINDOW_DAYS;
              return (
                <li key={r.id} className="px-5 py-3">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : r.id)}
                      className="mt-1 text-text-tertiary hover:text-foreground"
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-medium text-foreground">
                          {TABLE_LABELS[r.table_name] ?? r.table_name}
                        </span>
                        <span className="text-xs text-text-tertiary">
                          {r.action === "delete" ? "deleted" : "updated"} by{" "}
                          {r.actor_label ?? "Staff"} ·{" "}
                          {format(new Date(r.created_at), "MMM d, h:mm a")}
                        </span>
                        {r.restored_at && (
                          <span
                            className={cn(
                              "rounded-full bg-mist-bg px-2 py-0.5 text-[11px] font-medium text-success",
                            )}
                          >
                            reverted
                          </span>
                        )}
                      </div>
                      {summary && (
                        <p className="mt-0.5 truncate text-xs text-text-secondary">
                          {summary}
                        </p>
                      )}
                      {isExpanded && (
                        <DiffView before={r.before_json} after={r.after_json} />
                      )}
                    </div>
                    {undoable ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={restore.isPending && restore.variables === r.id}
                        onClick={() => restore.mutate(r.id)}
                      >
                        {restore.isPending && restore.variables === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Undo2 className="h-3.5 w-3.5" />
                        )}
                        Revert
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// One-line summary of what changed: pick up to two columns whose value
// differs and render "field: old → new". Skips noisy columns like
// updated_at / created_at that change on every write but aren't
// operator-meaningful.
const NOISE_COLUMNS = new Set([
  "id",
  "organization_id",
  "created_at",
  "updated_at",
]);
function summarize(r: SnapshotRow): string {
  if (r.action === "delete") {
    const name = (r.before_json as Record<string, unknown>).name;
    if (typeof name === "string" && name.length > 0) return `Removed "${name}"`;
    return "Row removed";
  }
  if (!r.after_json) return "";
  const before = r.before_json as Record<string, unknown>;
  const after = r.after_json as Record<string, unknown>;
  const changed: string[] = [];
  for (const key of Object.keys(after)) {
    if (NOISE_COLUMNS.has(key)) continue;
    if (!shallowEqual(before[key], after[key])) {
      const a = stringify(before[key]);
      const b = stringify(after[key]);
      changed.push(`${key}: ${a} → ${b}`);
      if (changed.length >= 2) break;
    }
  }
  return changed.join(" · ");
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a !== typeof b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 24 ? v.slice(0, 21) + "…" : v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v).slice(0, 32);
}

function ageInDays(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

// Full before/after diff for the expanded row. Only renders columns
// whose value actually changed (skipping noise) so the operator sees
// the same fields they edited.
function DiffView({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown> | null;
}) {
  const rows = useMemo(() => {
    const keys = new Set<string>([
      ...Object.keys(before ?? {}),
      ...Object.keys(after ?? {}),
    ]);
    const out: { key: string; before: string; after: string }[] = [];
    for (const k of keys) {
      if (NOISE_COLUMNS.has(k)) continue;
      const b = (before as Record<string, unknown>)[k];
      const a = (after as Record<string, unknown> | null)?.[k];
      if (shallowEqual(b, a)) continue;
      out.push({ key: k, before: stringify(b), after: stringify(a) });
    }
    return out;
  }, [before, after]);

  if (rows.length === 0) {
    return (
      <p className="mt-2 text-xs text-text-tertiary">No visible field changes.</p>
    );
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-border-subtle bg-background/60">
      <table className="w-full text-xs">
        <thead className="text-text-tertiary">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Field</th>
            <th className="px-3 py-2 text-left font-medium">Before</th>
            <th className="px-3 py-2 text-left font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border-subtle">
              <td className="px-3 py-2 font-medium text-foreground">{row.key}</td>
              <td className="px-3 py-2 text-text-secondary">{row.before}</td>
              <td className="px-3 py-2 text-text-secondary">{row.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
