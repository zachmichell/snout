import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Save, Download, Trash2, Play } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useReportTemplates, useSaveReportTemplate, useDeleteReportTemplate, type ReportConfig } from "@/hooks/useReportTemplates";
import { DateRange, dayKey } from "@/lib/analytics";
import { toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "sonner";

const SOURCES = [
  { value: "reservations", label: "Reservations" },
  { value: "invoices", label: "Invoices" },
  { value: "grooming", label: "Grooming Appointments" },
  { value: "memberships", label: "Memberships (started or cancelled)" },
];

const DIMENSIONS_BY_SOURCE: Record<string, { value: string; label: string }[]> = {
  reservations: [
    { value: "date", label: "Date" },
    { value: "service", label: "Service" },
    { value: "owner", label: "Owner" },
    { value: "status", label: "Status" },
  ],
  invoices: [
    { value: "date", label: "Date" },
    { value: "owner", label: "Owner" },
    { value: "status", label: "Status" },
  ],
  grooming: [
    { value: "date", label: "Date" },
    { value: "groomer", label: "Groomer" },
    { value: "status", label: "Status" },
  ],
  memberships: [
    { value: "date", label: "Date" },
    { value: "event", label: "Event (started or cancelled)" },
    { value: "package", label: "Package" },
    { value: "owner", label: "Owner" },
    { value: "status", label: "Current status" },
  ],
};

const METRICS_BY_SOURCE: Record<string, { value: string; label: string }[]> = {
  reservations: [
    { value: "count", label: "Count" },
    { value: "revenue", label: "Revenue (linked invoices)" },
  ],
  invoices: [
    { value: "count", label: "Count" },
    { value: "revenue", label: "Total" },
    { value: "tax", label: "Tax" },
  ],
  grooming: [
    { value: "count", label: "Count" },
    { value: "revenue", label: "Revenue" },
    { value: "tips", label: "Tips" },
    { value: "duration", label: "Duration (min)" },
  ],
  memberships: [
    { value: "count", label: "Count" },
  ],
};

export default function CustomReportsTab({ range }: { range: DateRange }) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const { data: templates = [] } = useReportTemplates();
  const save = useSaveReportTemplate();
  const del = useDeleteReportTemplate();

  const [config, setConfig] = useState<ReportConfig>({
    source: "reservations",
    dimensions: ["date"],
    metrics: ["count"],
    filters: [],
  });
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const dims = DIMENSIONS_BY_SOURCE[config.source] ?? [];
  const mets = METRICS_BY_SOURCE[config.source] ?? [];

  const { data: rows, isFetching, refetch } = useQuery({
    enabled: false,
    queryKey: ["custom-report-run", orgId, config, range.from.toISOString(), range.to.toISOString()],
    queryFn: () => runReport(orgId!, config, range),
  });

  const tableHeaders = useMemo(() => {
    const headers = [...config.dimensions, ...config.metrics];
    return headers.length > 0 ? headers : ["dimension"];
  }, [config]);

  const exportCsv = () => {
    if (!rows || rows.length === 0) {
      toast.error("Run the report first");
      return;
    }
    const csv = toCsv(rows, tableHeaders);
    downloadCsv(`report-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`, csv);
  };

  const loadTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setConfig(t.config);
    setEditingId(t.id);
    setName(t.name);
    setDesc(t.description ?? "");
  };

  const onSave = async () => {
    if (!name.trim()) {
      toast.error("Name required");
      return;
    }
    await save.mutateAsync({ id: editingId ?? undefined, name: name.trim(), description: desc.trim() || undefined, config });
    setSaveOpen(false);
  };

  const toggleArr = (arr: string[], val: string) => (arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Templates panel */}
        <Card className="p-5 shadow-card">
          <h3 className="font-display text-base text-foreground">Saved Reports</h3>
          <div className="mt-3 space-y-1">
            {templates.length === 0 && (
              <div className="text-xs text-text-secondary">None yet. Build a report and save it.</div>
            )}
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                <button onClick={() => loadTemplate(t.id)} className="flex-1 text-left text-sm text-foreground hover:underline">
                  {t.name}
                </button>
                <button
                  onClick={() => { if (confirm(`Delete "${t.name}"?`)) del.mutate(t.id); }}
                  className="rounded p-1 text-text-tertiary hover:text-destructive"
                  aria-label="Delete template"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 w-full"
            onClick={() => {
              setEditingId(null);
              setConfig({ source: "reservations", dimensions: ["date"], metrics: ["count"], filters: [] });
              setName("");
              setDesc("");
            }}
          >
            <Plus className="h-4 w-4" /> New report
          </Button>
        </Card>

        {/* Builder */}
        <div className="space-y-4">
          <Card className="p-5 shadow-card">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Data source</Label>
                <Select
                  value={config.source}
                  onValueChange={(v) =>
                    setConfig({ source: v as ReportConfig["source"], dimensions: ["date"], metrics: ["count"], filters: [] })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Dimensions</Label>
                  <div className="space-y-1.5">
                    {dims.map((d) => (
                      <label key={d.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={config.dimensions.includes(d.value)}
                          onCheckedChange={() => setConfig({ ...config, dimensions: toggleArr(config.dimensions, d.value) })}
                        />
                        {d.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Metrics</Label>
                  <div className="space-y-1.5">
                    {mets.map((m) => (
                      <label key={m.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={config.metrics.includes(m.value)}
                          onCheckedChange={() => setConfig({ ...config, metrics: toggleArr(config.metrics, m.value) })}
                        />
                        {m.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={() => refetch()} disabled={isFetching}>
                  <Play className="h-4 w-4" /> {isFetching ? "Running…" : "Run report"}
                </Button>
                <Button variant="outline" onClick={() => setSaveOpen(true)}>
                  <Save className="h-4 w-4" /> {editingId ? "Update template" : "Save as template"}
                </Button>
                <Button variant="outline" onClick={exportCsv} disabled={!rows || rows.length === 0}>
                  <Download className="h-4 w-4" /> Export CSV
                </Button>
                <div className="ml-auto self-center text-xs text-text-secondary">{range.label}</div>
              </div>
            </div>
          </Card>

          <Card className="p-5 shadow-card">
            <h3 className="mb-3 font-display text-base text-foreground">Results</h3>
            {!rows ? (
              <div className="py-12 text-center text-sm text-text-secondary">Configure and run the report to see results.</div>
            ) : rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-text-secondary">No data for this configuration.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                      {tableHeaders.map((h) => (<th key={h} className="pb-2 pr-3 font-semibold">{h}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-border-subtle last:border-0">
                        {tableHeaders.map((h) => (
                          <td key={h} className="py-2 pr-3 text-foreground">{String(r[h] ?? "—")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Update template" : "Save report template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rt-name">Name</Label>
              <Input id="rt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly daycare summary" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-desc">Description (optional)</Label>
              <Textarea id="rt-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ runner ============

async function runReport(orgId: string, config: ReportConfig, range: DateRange): Promise<Record<string, any>[]> {
  if (config.source === "reservations") return runReservations(orgId, config, range);
  if (config.source === "invoices") return runInvoices(orgId, config, range);
  if (config.source === "grooming") return runGrooming(orgId, config, range);
  if (config.source === "memberships") return runMemberships(orgId, config, range);
  return [];
}

async function runReservations(orgId: string, c: ReportConfig, range: DateRange) {
  const [resRes, svcRes, ownersRes, invRes] = await Promise.all([
    supabase.from("reservations")
      .select("id, start_at, service_id, primary_owner_id, status")
      .eq("organization_id", orgId).is("deleted_at", null)
      .gte("start_at", range.from.toISOString()).lte("start_at", range.to.toISOString()).limit(10000),
    supabase.from("services").select("id, name").eq("organization_id", orgId),
    supabase.from("owners").select("id, first_name, last_name").eq("organization_id", orgId),
    c.metrics.includes("revenue")
      ? supabase.from("invoices").select("reservation_id, total_cents, status").eq("organization_id", orgId).is("deleted_at", null)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const svcMap = new Map((svcRes.data ?? []).map((s: any) => [s.id, s.name]));
  const ownerMap = new Map((ownersRes.data ?? []).map((o: any) => [o.id, `${o.first_name} ${o.last_name}`]));
  const revByRes = new Map<string, number>();
  for (const i of (invRes.data ?? []) as any[]) {
    if (!i.reservation_id) continue;
    if (i.status !== "paid" && i.status !== "partial") continue;
    revByRes.set(i.reservation_id, (revByRes.get(i.reservation_id) ?? 0) + (i.total_cents ?? 0));
  }
  return aggregate(
    (resRes.data ?? []).map((r: any) => ({
      date: dayKey(new Date(r.start_at)),
      service: r.service_id ? svcMap.get(r.service_id) ?? "—" : "—",
      owner: r.primary_owner_id ? ownerMap.get(r.primary_owner_id) ?? "—" : "—",
      status: r.status,
      _revenue: (revByRes.get(r.id) ?? 0) / 100,
    })),
    c,
  );
}

async function runInvoices(orgId: string, c: ReportConfig, range: DateRange) {
  const [invRes, ownersRes] = await Promise.all([
    supabase.from("invoices")
      .select("id, owner_id, total_cents, tax_cents, status, created_at")
      .eq("organization_id", orgId).is("deleted_at", null)
      .gte("created_at", range.from.toISOString()).lte("created_at", range.to.toISOString()).limit(10000),
    supabase.from("owners").select("id, first_name, last_name").eq("organization_id", orgId),
  ]);
  const ownerMap = new Map((ownersRes.data ?? []).map((o: any) => [o.id, `${o.first_name} ${o.last_name}`]));
  return aggregate(
    (invRes.data ?? []).map((i: any) => ({
      date: dayKey(new Date(i.created_at)),
      owner: ownerMap.get(i.owner_id) ?? "—",
      status: i.status,
      _revenue: (i.total_cents ?? 0) / 100,
      _tax: (i.tax_cents ?? 0) / 100,
    })),
    c,
  );
}

async function runGrooming(orgId: string, c: ReportConfig, range: DateRange) {
  const [gRes, gms] = await Promise.all([
    supabase.from("grooming_appointments")
      .select("id, appointment_date, groomer_id, status, price_cents, tip_cents, estimated_duration_minutes")
      .eq("organization_id", orgId)
      .gte("appointment_date", range.from.toISOString().slice(0, 10))
      .lte("appointment_date", range.to.toISOString().slice(0, 10)).limit(10000),
    supabase.from("groomers").select("id, display_name").eq("organization_id", orgId),
  ]);
  const gmMap = new Map((gms.data ?? []).map((g: any) => [g.id, g.display_name]));
  return aggregate(
    (gRes.data ?? []).map((g: any) => ({
      date: g.appointment_date,
      groomer: gmMap.get(g.groomer_id) ?? "—",
      status: g.status,
      _revenue: (g.price_cents ?? 0) / 100,
      _tips: (g.tip_cents ?? 0) / 100,
      _duration: g.estimated_duration_minutes ?? 0,
    })),
    c,
  );
}

async function runMemberships(orgId: string, c: ReportConfig, range: DateRange) {
  // The owner_subscriptions table records purchase time but does not have a
  // dedicated cancelled_at column. We approximate "cancelled in range" by
  // (status = 'cancelled' AND updated_at in range AND not equal to purchase
  // time). Each subscription can emit up to two synthetic rows: one for the
  // start event, one for the cancel event.
  const [subs, packages, owners] = await Promise.all([
    supabase
      .from("owner_subscriptions")
      .select("id, owner_id, package_id, status, purchased_at, updated_at")
      .eq("organization_id", orgId)
      .limit(10000),
    supabase.from("subscription_packages").select("id, name").eq("organization_id", orgId),
    supabase.from("owners").select("id, first_name, last_name").eq("organization_id", orgId),
  ]);
  const pkgMap = new Map((packages.data ?? []).map((p: any) => [p.id, p.name]));
  const ownerMap = new Map(
    (owners.data ?? []).map((o: any) => [o.id, `${o.first_name} ${o.last_name}`]),
  );

  const fromMs = range.from.getTime();
  const toMs = range.to.getTime();
  const inRange = (iso: string | null) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= fromMs && t <= toMs;
  };

  const events: Array<Record<string, any>> = [];
  for (const s of (subs.data ?? []) as any[]) {
    const pkg = s.package_id ? pkgMap.get(s.package_id) ?? "—" : "—";
    const owner = s.owner_id ? ownerMap.get(s.owner_id) ?? "—" : "—";

    if (inRange(s.purchased_at)) {
      events.push({
        date: dayKey(new Date(s.purchased_at)),
        event: "started",
        package: pkg,
        owner,
        status: s.status,
      });
    }
    if (
      s.status === "cancelled" &&
      inRange(s.updated_at) &&
      // Don't double-count when a subscription was cancelled at purchase time.
      (!s.purchased_at || new Date(s.updated_at).getTime() !== new Date(s.purchased_at).getTime())
    ) {
      events.push({
        date: dayKey(new Date(s.updated_at)),
        event: "cancelled",
        package: pkg,
        owner,
        status: s.status,
      });
    }
  }
  return aggregate(events, c);
}

function aggregate(rows: any[], c: ReportConfig): Record<string, any>[] {
  const groups = new Map<string, any>();
  for (const r of rows) {
    const dimVals = c.dimensions.map((d) => String(r[d] ?? "—"));
    const key = dimVals.join("||");
    let g = groups.get(key);
    if (!g) {
      g = {};
      c.dimensions.forEach((d, i) => (g[d] = dimVals[i]));
      for (const m of c.metrics) g[m] = 0;
      groups.set(key, g);
    }
    for (const m of c.metrics) {
      if (m === "count") g[m] += 1;
      else if (m === "revenue") g[m] = +(g[m] + (r._revenue ?? 0)).toFixed(2);
      else if (m === "tax") g[m] = +(g[m] + (r._tax ?? 0)).toFixed(2);
      else if (m === "tips") g[m] = +(g[m] + (r._tips ?? 0)).toFixed(2);
      else if (m === "duration") g[m] += r._duration ?? 0;
    }
  }
  return Array.from(groups.values()).sort((a, b) => {
    for (const d of c.dimensions) {
      if (a[d] < b[d]) return -1;
      if (a[d] > b[d]) return 1;
    }
    return 0;
  });
}
