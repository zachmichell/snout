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
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DateRange, dayKey, eachDayInRange } from "@/lib/analytics";

export default function OccupancyTab({ data, range }: { data: any; range: DateRange }) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data: extra } = useQuery({
    enabled: !!orgId,
    queryKey: ["occupancy-extra", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      const [reservationsRes, servicesRes, suitesRes] = await Promise.all([
        supabase
          .from("reservations")
          .select("id, start_at, end_at, service_id, status, suite_id")
          .eq("organization_id", orgId!)
          .is("deleted_at", null)
          .gte("start_at", range.from.toISOString())
          .lte("start_at", range.to.toISOString())
          .limit(5000),
        supabase.from("services").select("id, name, module").eq("organization_id", orgId!).is("deleted_at", null),
        supabase.from("kennel_runs").select("id, name").eq("organization_id", orgId!).eq("active", true).is("deleted_at", null),
      ]);

      const reservations = (reservationsRes.data ?? []) as any[];
      const services = (servicesRes.data ?? []) as any[];
      const suites = (suitesRes.data ?? []) as any[];
      const serviceMap = new Map(services.map((s) => [s.id, s]));

      const days = eachDayInRange(range);
      const buckets = new Map(days.map((d) => [d.key, { key: d.key, label: d.label, daycare: 0, boarding: 0 }]));
      for (const r of reservations) {
        if (r.status === "cancelled" || r.status === "no_show") continue;
        const k = dayKey(new Date(r.start_at));
        const b = buckets.get(k);
        if (!b) continue;
        const m = r.service_id ? serviceMap.get(r.service_id)?.module : null;
        if (m === "daycare") b.daycare++;
        else if (m === "boarding") b.boarding++;
      }
      const series = Array.from(buckets.values());

      // Average pets per day per module
      const dayCount = days.length || 1;
      const avgDaycare = series.reduce((s, d) => s + d.daycare, 0) / dayCount;
      const avgBoarding = series.reduce((s, d) => s + d.boarding, 0) / dayCount;

      // Peak day analysis
      const weekdayCounts = new Array(7).fill(0);
      const weekdayDays = new Array(7).fill(0);
      const NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      for (const d of days) {
        weekdayDays[d.date.getDay()]++;
      }
      for (const r of reservations) {
        if (r.status === "cancelled" || r.status === "no_show") continue;
        const dow = new Date(r.start_at).getDay();
        weekdayCounts[dow]++;
      }
      const weekday = weekdayCounts.map((c, i) => ({ day: NAMES[i], avg: weekdayDays[i] > 0 ? c / weekdayDays[i] : 0 }));

      // Suite utilization
      const suiteCounts = new Map<string, number>();
      for (const r of reservations) {
        if (!r.suite_id) continue;
        if (r.status === "cancelled" || r.status === "no_show") continue;
        suiteCounts.set(r.suite_id, (suiteCounts.get(r.suite_id) ?? 0) + 1);
      }
      const suiteUtil = suites.map((s) => ({
        name: s.name,
        count: suiteCounts.get(s.id) ?? 0,
      })).sort((a, b) => b.count - a.count);

      return { series, avgDaycare, avgBoarding, weekday, suiteUtil };
    },
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">Daycare Occupancy (today)</div>
          <div className="mt-2 font-display text-2xl text-foreground">{Math.round(data.totals.daycareOccupancy)}%</div>
          <div className="mt-1 text-xs text-text-secondary">{data.totals.daycarePets}/{data.totals.daycareCapacity}</div>
        </Card>
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">Boarding Occupancy (today)</div>
          <div className="mt-2 font-display text-2xl text-foreground">{Math.round(data.totals.boardingOccupancy)}%</div>
          <div className="mt-1 text-xs text-text-secondary">{data.totals.occupiedRuns}/{data.totals.totalRuns}</div>
        </Card>
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">Avg Daycare/day</div>
          <div className="mt-2 font-display text-2xl text-foreground">{(extra?.avgDaycare ?? 0).toFixed(1)}</div>
        </Card>
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">Avg Boarding/day</div>
          <div className="mt-2 font-display text-2xl text-foreground">{(extra?.avgBoarding ?? 0).toFixed(1)}</div>
        </Card>
      </div>

      <Card className="p-5 shadow-card">
        <div className="mb-4">
          <h3 className="font-display text-base text-foreground">Pets per Day</h3>
          <div className="text-xs text-text-secondary">{range.label}</div>
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={extra?.series ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }} />
              <Line type="monotone" dataKey="daycare" stroke="hsl(var(--brand-sage))" strokeWidth={2.5} dot={false} name="Daycare" />
              <Line type="monotone" dataKey="boarding" stroke="hsl(var(--brand-plum))" strokeWidth={2.5} dot={false} name="Boarding" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base text-foreground">Peak Days</h3>
            <div className="text-xs text-text-secondary">Avg reservations per weekday</div>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={extra?.weekday ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip formatter={(v: number) => [v.toFixed(1), "Avg"]} />
                <Bar dataKey="avg" fill="hsl(var(--brand-camel))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base text-foreground">Suite Utilization</h3>
            <div className="text-xs text-text-secondary">Reservations per suite in period</div>
          </div>
          {!extra || extra.suiteUtil.length === 0 ? (
            <div className="py-12 text-center text-sm text-text-secondary">No suites configured</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={extra.suiteUtil} layout="vertical" margin={{ left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--brand-plum))" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
