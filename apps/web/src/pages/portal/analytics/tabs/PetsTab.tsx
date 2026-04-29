import { Card } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { usePetAnalytics } from "@/hooks/usePetAnalytics";
import { DateRange } from "@/lib/analytics";

const COLORS = [
  "hsl(var(--brand-camel))",
  "hsl(var(--brand-sage))",
  "hsl(var(--brand-plum))",
  "hsl(var(--brand-cotton))",
  "hsl(var(--brand-frost))",
  "hsl(var(--brand-gold))",
];

export default function PetsTab({ range }: { range: DateRange }) {
  const { data, isLoading } = usePetAnalytics(range);
  if (isLoading || !data) return <div className="text-sm text-text-secondary">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">Total Active Pets</div>
          <div className="mt-2 font-display text-2xl text-foreground">{data.totalActive}</div>
        </Card>
        <Card className="p-5 shadow-card">
          <div className="label-eyebrow">New Registrations</div>
          <div className="mt-2 font-display text-2xl text-foreground">{data.newPets}</div>
          <div className="mt-1 text-xs text-text-secondary">{range.label}</div>
        </Card>
      </div>

      <Card className="p-5 shadow-card">
        <div className="mb-4">
          <h3 className="font-display text-base text-foreground">New Pets Over Time</h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={data.newPetsSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="hsl(var(--brand-cotton))" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base text-foreground">By Species</h3>
          </div>
          {data.bySpecies.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-secondary">No pets</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.bySpecies} dataKey="count" nameKey="species" outerRadius={80} label>
                    {data.bySpecies.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base text-foreground">Top Breeds</h3>
          </div>
          {data.byBreed.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-secondary">No breed data</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={data.byBreed} layout="vertical" margin={{ left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <YAxis type="category" dataKey="breed" width={120} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--brand-sage))" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5 shadow-card">
        <div className="mb-4">
          <h3 className="font-display text-base text-foreground">Most Popular Services</h3>
          <div className="text-xs text-text-secondary">By reservation count</div>
        </div>
        {data.popularServices.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-secondary">No reservations in this period</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.popularServices}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--brand-plum))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
