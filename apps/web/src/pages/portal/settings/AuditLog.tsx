import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime } from "@/lib/money";
import { downloadCsv, toCsv } from "@/lib/csv";

const ACTIONS = [
  "created",
  "updated",
  "confirmed",
  "cancelled",
  "deleted",
  "checked_in",
  "checked_out",
  "no_show",
  "commented",
  "uploaded",
  "photo_uploaded",
  "signed",
  "paid",
  "refunded",
  "imported",
  "merged",
];
const ENTITIES = [
  "reservation",
  "invoice",
  "payment",
  "pet",
  "owner",
  "vaccination",
  "agreement",
  "waiver_signature",
  "document",
  "settings",
  "import",
  "merge",
  "service",
  "checkin",
  "checkout",
];
const ACTOR_KINDS = ["staff", "owner", "system"];

export default function AuditLog() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const [action, setAction] = useState<string>("all");
  const [entity, setEntity] = useState<string>("all");
  const [actorId, setActorId] = useState<string>("all");
  const [actorKind, setActorKind] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const { data: actors = [] } = useQuery({
    queryKey: ["audit-actors", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from("memberships")
        .select("profile_id, profiles:profile_id(id, first_name, last_name, email)")
        .eq("organization_id", orgId!)
        .eq("active", true);
      return (data ?? []).map((m: any) => m.profiles).filter(Boolean);
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["audit-log", orgId, action, entity, actorId, actorKind, from, to],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from("activity_log")
        .select("id, created_at, action, entity_type, entity_id, metadata, actor_id, profiles:actor_id(first_name, last_name, email)")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (action !== "all") q = q.eq("action", action);
      if (entity !== "all") q = q.eq("entity_type", entity);
      if (actorId !== "all") q = q.eq("actor_id", actorId);
      if (from) q = q.gte("created_at", new Date(from + "T00:00:00").toISOString());
      if (to) q = q.lte("created_at", new Date(to + "T23:59:59").toISOString());
      const { data, error } = await q;
      if (error) throw error;
      // metadata.actor_kind lives in jsonb so the filter happens client-side
      // until we promote actor_kind to a top-level column.
      let filtered = data ?? [];
      if (actorKind !== "all") {
        filtered = filtered.filter(
          (r: any) => (r.metadata?.actor_kind ?? "system") === actorKind,
        );
      }
      return filtered;
    },
  });

  const exportCsv = () => {
    const csv = toCsv(
      rows.map((r: any) => ({
        timestamp: r.created_at,
        actor: actorDisplay(r),
        action: r.action,
        entity_type: r.entity_type,
        entity_id: r.entity_id ?? "",
        details: r.metadata ? JSON.stringify(r.metadata) : "",
      })),
      ["timestamp", "actor", "action", "entity_type", "entity_id", "details"],
    );
    downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const summary = useMemo(() => `${rows.length} record${rows.length === 1 ? "" : "s"}${rows.length === 500 ? " (max)" : ""}`, [rows.length]);

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Audit Log"
          description="Read-only system activity. Records cannot be deleted."
          actions={<Button variant="outline" onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}
        />
        <div className="rounded-lg border border-border bg-surface shadow-card">
          <div className="flex flex-wrap items-end gap-3 border-b border-border-subtle p-4">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-text-secondary">Action</label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="w-40 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-text-secondary">Entity</label>
              <Select value={entity} onValueChange={setEntity}>
                <SelectTrigger className="w-40 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All entities</SelectItem>
                  {ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-text-secondary">Actor type</label>
              <Select value={actorKind} onValueChange={setActorKind}>
                <SelectTrigger className="w-36 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Anyone</SelectItem>
                  {ACTOR_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-text-secondary">User</label>
              <Select value={actorId} onValueChange={setActorId}>
                <SelectTrigger className="w-52 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All users</SelectItem>
                  {actors.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {`${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-text-secondary">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-background" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-text-secondary">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-background" />
            </div>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-sm text-text-secondary">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={ScrollText} title="No activity" description="Activity will appear here once users start working in the app." />
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-background text-left">
                    <th className="px-[18px] py-[14px] label-eyebrow">Timestamp</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">User</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Action</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Entity</th>
                    <th className="px-[18px] py-[14px] label-eyebrow">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="border-t border-border-subtle hover:bg-background">
                      <td className="px-[18px] py-[14px] whitespace-nowrap text-text-secondary">{formatDateTime(r.created_at)}</td>
                      <td className="px-[18px] py-[14px] text-text-secondary">
                        {actorDisplayElement(r)}
                      </td>
                      <td className="px-[18px] py-[14px]">
                        <span className="inline-flex items-center rounded-pill bg-primary-light px-2.5 py-0.5 text-xs font-semibold text-primary capitalize">
                          {String(r.action).replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-[18px] py-[14px] text-foreground capitalize">{r.entity_type}</td>
                      <td className="px-[18px] py-[14px] text-text-secondary">
                        {r.metadata ? (
                          <code className="font-mono text-[11px]">{JSON.stringify(r.metadata)}</code>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-border-subtle px-4 py-3 text-xs text-text-secondary">{summary}</div>
            </>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}

function actorDisplay(row: any): string {
  // Prefer a joined profile (the staff who acted under their org-level
  // session), fall back to the actor_label captured in metadata (which is
  // the active staff PIN or 'Owner' or 'System' from useLogActivity).
  if (row.profiles) {
    const name = `${row.profiles.first_name ?? ""} ${row.profiles.last_name ?? ""}`.trim();
    return name || row.profiles.email || "Staff";
  }
  return row.metadata?.actor_label ?? "System";
}

function actorDisplayElement(row: any) {
  const text = actorDisplay(row);
  if (!row.profiles && !row.metadata?.actor_label) {
    return <span className="text-text-tertiary">system</span>;
  }
  return text;
}
