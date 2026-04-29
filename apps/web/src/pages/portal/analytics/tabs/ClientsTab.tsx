import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from "recharts";
import { useClientAnalytics } from "@/hooks/useClientAnalytics";
import { DateRange, formatMoney } from "@/lib/analytics";

export default function ClientsTab({ range, currency }: { range: DateRange; currency: string }) {
  const { data, isLoading } = useClientAnalytics(range);

  if (isLoading || !data) return <div className="text-sm text-text-secondary">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">New Clients</div>
          <div className="mt-2 font-display text-2xl text-foreground">{data.newClients}</div>
          <div className="mt-1 text-xs text-text-secondary">{range.label}</div>
        </Card>
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">30-day Retention</div>
          <div className="mt-2 font-display text-2xl text-foreground">{data.retention30.toFixed(1)}%</div>
        </Card>
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">60-day Retention</div>
          <div className="mt-2 font-display text-2xl text-foreground">{data.retention60.toFixed(1)}%</div>
        </Card>
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">90-day Retention</div>
          <div className="mt-2 font-display text-2xl text-foreground">{data.retention90.toFixed(1)}%</div>
        </Card>
      </div>

      <Card className="p-5 shadow-card">
        <div className="mb-4">
          <h3 className="font-display text-base text-foreground">New Clients Over Time</h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={data.newClientsSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="hsl(var(--brand-camel))" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base text-foreground">Top Clients by Revenue</h3>
            <div className="text-xs text-text-secondary">Avg visits/client: {data.avgVisits.toFixed(1)}</div>
          </div>
          {data.topClients.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-secondary">No paid invoices in this period</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                    <th className="pb-2 pr-3 font-semibold">Client</th>
                    <th className="pb-2 pr-3 font-semibold text-right">Visits</th>
                    <th className="pb-2 font-semibold text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topClients.map((c) => (
                    <tr key={c.id} className="border-b border-border-subtle last:border-0">
                      <td className="py-2 pr-3">
                        <Link to={`/owners/${c.id}`} className="text-primary hover:underline">{c.name}</Link>
                      </td>
                      <td className="py-2 pr-3 text-right text-text-secondary">{c.visits}</td>
                      <td className="py-2 text-right font-medium text-foreground">{formatMoney(c.revenue, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base text-foreground">Acquisition by Source</h3>
          </div>
          {data.bySource.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-secondary">No new clients in this period</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={data.bySource} layout="vertical" margin={{ left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <YAxis type="category" dataKey="source" width={120} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--brand-sage))" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
