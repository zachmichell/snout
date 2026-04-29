import { Card } from "@/components/ui/card";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DateRange, formatMoney } from "@/lib/analytics";

const COLORS = [
  "hsl(var(--brand-camel))",
  "hsl(var(--brand-sage))",
  "hsl(var(--brand-plum))",
  "hsl(var(--brand-cotton))",
  "hsl(var(--brand-frost))",
  "hsl(var(--brand-gold))",
];

export default function RevenueTab({
  data,
  range,
  currency,
}: {
  data: any;
  range: DateRange;
  currency: string;
}) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data: extra } = useQuery({
    enabled: !!orgId,
    queryKey: ["revenue-extra", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      const [invoicesRes, paymentsRes, groomingRes, servicesRes, linesRes] = await Promise.all([
        supabase
          .from("invoices")
          .select("id, total_cents, status, paid_at, created_at")
          .eq("organization_id", orgId!)
          .is("deleted_at", null)
          .gte("created_at", range.from.toISOString())
          .lte("created_at", range.to.toISOString())
          .limit(5000),
        supabase
          .from("payments" as any)
          .select("amount_cents, method, paid_at")
          .eq("organization_id", orgId!)
          .gte("paid_at", range.from.toISOString())
          .lte("paid_at", range.to.toISOString())
          .limit(5000),
        supabase
          .from("grooming_appointments")
          .select("id, price_cents, tip_cents, groomer_id, status, completed_time")
          .eq("organization_id", orgId!)
          .gte("appointment_date", range.from.toISOString().slice(0, 10))
          .lte("appointment_date", range.to.toISOString().slice(0, 10))
          .limit(5000),
        supabase.from("services").select("id, name, module").eq("organization_id", orgId!).is("deleted_at", null),
        supabase
          .from("invoice_lines")
          .select("invoice_id, service_id, line_total_cents")
          .eq("organization_id", orgId!)
          .limit(20000),
      ]);

      const invoices = (invoicesRes.data ?? []) as any[];
      const payments = (paymentsRes.data ?? []) as any[];
      const grooming = (groomingRes.data ?? []) as any[];
      const services = (servicesRes.data ?? []) as any[];
      const lines = (linesRes.data ?? []) as any[];
      const serviceMap = new Map(services.map((s) => [s.id, s]));
      const invoiceIds = new Set(invoices.filter((i) => i.status === "paid" || i.status === "partial").map((i) => i.id));

      // Revenue by service type (from invoice lines on paid invoices)
      const byService = new Map<string, number>();
      for (const l of lines) {
        if (!invoiceIds.has(l.invoice_id)) continue;
        const svc = l.service_id ? serviceMap.get(l.service_id) : null;
        const key = svc?.name ?? "Other";
        byService.set(key, (byService.get(key) ?? 0) + (l.line_total_cents ?? 0));
      }
      const serviceRevenue = Array.from(byService.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);

      // By payment method
      const byMethod = new Map<string, number>();
      for (const p of payments) {
        const m = (p.method as string) ?? "other";
        byMethod.set(m, (byMethod.get(m) ?? 0) + (p.amount_cents ?? 0));
      }
      const methodRevenue = Array.from(byMethod.entries()).map(([method, value]) => ({ method, value }));

      // Avg transaction
      const paid = invoices.filter((i) => i.status === "paid" || i.status === "partial");
      const avgTxn = paid.length > 0 ? paid.reduce((s, i) => s + (i.total_cents ?? 0), 0) / paid.length : 0;

      // Tips
      const totalTips = grooming.reduce((s, g) => s + (g.tip_cents ?? 0), 0);
      const tipsByGroomer = new Map<string, number>();
      for (const g of grooming) {
        if (!g.tip_cents) continue;
        const key = g.groomer_id ?? "—";
        tipsByGroomer.set(key, (tipsByGroomer.get(key) ?? 0) + g.tip_cents);
      }
      // Resolve groomer names
      const groomerIds = Array.from(tipsByGroomer.keys()).filter((id) => id !== "—");
      let groomerNameMap = new Map<string, string>();
      if (groomerIds.length > 0) {
        const { data: gs } = await supabase.from("groomers").select("id, display_name").in("id", groomerIds);
        groomerNameMap = new Map((gs ?? []).map((g: any) => [g.id, g.display_name]));
      }
      const tipsList = Array.from(tipsByGroomer.entries()).map(([id, value]) => ({
        name: groomerNameMap.get(id) ?? "Unassigned",
        value,
      })).sort((a, b) => b.value - a.value);

      return { serviceRevenue, methodRevenue, avgTxn, totalTips, tipsList };
    },
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">Total Revenue</div>
          <div className="mt-2 font-display text-2xl text-foreground">{formatMoney(data.totals.revenue, currency)}</div>
          <div className="mt-1 text-xs text-text-secondary">vs. {formatMoney(data.totals.revenuePrev, currency)} prev</div>
        </Card>
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">Avg Transaction</div>
          <div className="mt-2 font-display text-2xl text-foreground">{formatMoney(extra?.avgTxn ?? 0, currency)}</div>
        </Card>
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">Tips Collected</div>
          <div className="mt-2 font-display text-2xl text-foreground">{formatMoney(extra?.totalTips ?? 0, currency)}</div>
          <div className="mt-1 text-xs text-text-secondary">grooming appointments</div>
        </Card>
      </div>

      <Card className="p-5 shadow-card">
        <div className="mb-4">
          <h3 className="font-display text-base text-foreground">Revenue Over Time</h3>
          <div className="text-xs text-text-secondary">{range.label}</div>
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={data.revenueSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]}
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
              />
              <Line type="monotone" dataKey="revenue" stroke="hsl(var(--brand-gold))" strokeWidth={2.5} dot={{ r: 3, fill: "hsl(var(--brand-gold))" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base text-foreground">Revenue by Service</h3>
          </div>
          {!extra || extra.serviceRevenue.length === 0 ? (
            <div className="py-12 text-center text-sm text-text-secondary">No revenue in this period</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={extra.serviceRevenue}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={80}
                    label={(d) => `${d.name}`}
                  >
                    {extra.serviceRevenue.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`$${(v / 100).toFixed(2)}`, "Revenue"]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base text-foreground">By Payment Method</h3>
          </div>
          {!extra || extra.methodRevenue.length === 0 ? (
            <div className="py-12 text-center text-sm text-text-secondary">No payments recorded</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={extra.methodRevenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="method" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip formatter={(v: number) => [`$${(v / 100).toFixed(2)}`, "Total"]} />
                  <Bar dataKey="value" fill="hsl(var(--brand-camel))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {extra && extra.tipsList.length > 0 && (
        <Card className="p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base text-foreground">Tips by Groomer</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                  <th className="pb-2 pr-3 font-semibold">Groomer</th>
                  <th className="pb-2 font-semibold text-right">Tips</th>
                </tr>
              </thead>
              <tbody>
                {extra.tipsList.map((t, i) => (
                  <tr key={i} className="border-b border-border-subtle last:border-0">
                    <td className="py-2 pr-3 text-foreground">{t.name}</td>
                    <td className="py-2 text-right font-medium text-foreground">{formatMoney(t.value, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
