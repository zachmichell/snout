import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Calendar as CalendarIcon, Download } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { downloadCsv, toCsv } from "@/lib/csv";
import * as R from "@/lib/reports";

const CHART_COLORS = ["#CBA48F", "#F2D3C9", "#EED4BB", "#CBD5D6", "#C7D0C5", "#CDB5B1"];

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function RangePicker({
  range,
  onChange,
}: {
  range: R.DateRange;
  onChange: (r: R.DateRange) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        onValueChange={(v) => {
          const fn = (R.presets as any)[v];
          if (fn) onChange(fn());
        }}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Quick range" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="last7">Last 7 days</SelectItem>
          <SelectItem value="last30">Last 30 days</SelectItem>
          <SelectItem value="last90">Last 90 days</SelectItem>
          <SelectItem value="thisMonth">This month</SelectItem>
          <SelectItem value="ytd">Year to date</SelectItem>
        </SelectContent>
      </Select>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-[140px] justify-start font-normal">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {format(range.from, "MMM d")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={range.from}
            onSelect={(d) => d && onChange({ ...range, from: d })}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
      <span className="text-text-secondary">→</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-[140px] justify-start font-normal">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {format(range.to, "MMM d")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={range.to}
            onSelect={(d) => d && onChange({ ...range, to: d })}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ReportCard({
  title,
  description,
  children,
  onExport,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onExport?: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="font-display text-lg">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SimpleTable({ rows, columns }: { rows: any[]; columns: { key: string; label: string; format?: (v: any) => string }[] }) {
  if (!rows || rows.length === 0) {
    return <div className="py-6 text-center text-sm text-text-secondary">No data for selected period.</div>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 text-left font-medium text-text-secondary">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r, i) => (
            <tr key={i} className="border-t border-border hover:bg-muted/20">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2">
                  {c.format ? c.format(r[c.key]) : r[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && (
        <div className="border-t border-border px-3 py-2 text-xs text-text-secondary">
          Showing first 100 of {rows.length} rows. Export CSV for full data.
        </div>
      )}
    </div>
  );
}

// ===== FINANCIAL =====
function FinancialTab({ orgId, range }: { orgId: string; range: R.DateRange }) {
  const [bucket, setBucket] = useState<R.Bucket>("day");

  const revenueQ = useQuery({
    queryKey: ["rep-rev", orgId, range.from.toISOString(), range.to.toISOString(), bucket],
    queryFn: () => R.fetchRevenueByDate(orgId, range, bucket),
  });
  const eodQ = useQuery({ queryKey: ["rep-eod", orgId], queryFn: () => R.fetchEndOfDay(orgId, new Date()) });
  const taxQ = useQuery({
    queryKey: ["rep-tax", orgId, range.from.toISOString(), range.to.toISOString(), bucket],
    queryFn: () => R.fetchSalesTax(orgId, range, bucket),
  });
  const outstandingQ = useQuery({ queryKey: ["rep-out", orgId], queryFn: () => R.fetchOutstanding(orgId) });
  const refundsQ = useQuery({
    queryKey: ["rep-refunds", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: () => R.fetchRefunds(orgId, range),
  });
  const depositsQ = useQuery({
    queryKey: ["rep-deps", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: () => R.fetchDeposits(orgId, range),
  });
  const pkgQ = useQuery({
    queryKey: ["rep-pkg", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: () => R.fetchPackageSales(orgId, range),
  });

  return (
    <div className="space-y-6">
      <ReportCard
        title="Revenue by Date Range"
        description={`Total paid invoices grouped by ${bucket}`}
        onExport={() =>
          downloadCsv(
            "revenue.csv",
            toCsv((revenueQ.data ?? []).map((r) => ({ period: r.period, revenue_dollars: (r.revenue / 100).toFixed(2), invoices: r.count }))),
          )
        }
      >
        <div className="mb-3 flex items-center gap-2">
          <Select value={bucket} onValueChange={(v: R.Bucket) => setBucket(v)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={revenueQ.data ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E0D4CC" />
            <XAxis dataKey="period" stroke="#6E5E54" fontSize={11} />
            <YAxis stroke="#6E5E54" fontSize={11} tickFormatter={(v) => `$${(v / 100).toFixed(0)}`} />
            <Tooltip formatter={(v: any) => money(Number(v))} />
            <Bar dataKey="revenue" fill="#CBA48F" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3">
          <SimpleTable
            rows={revenueQ.data ?? []}
            columns={[
              { key: "period", label: "Period" },
              { key: "revenue", label: "Revenue", format: (v) => money(v) },
              { key: "count", label: "Invoices" },
            ]}
          />
        </div>
      </ReportCard>

      <ReportCard title="End of Day Summary" description={`Today, ${format(new Date(), "MMM d, yyyy")}`}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: "Revenue", value: money(eodQ.data?.revenue ?? 0) },
            { label: "Transactions", value: eodQ.data?.transactions ?? 0 },
            { label: "Tax Collected", value: money(eodQ.data?.tax ?? 0) },
            { label: "Refunds", value: money(eodQ.data?.refunds ?? 0) },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{m.label}</div>
              <div className="mt-1 font-display text-2xl">{m.value}</div>
            </div>
          ))}
        </div>
      </ReportCard>

      <ReportCard
        title="Sales Tax Report"
        onExport={() =>
          downloadCsv(
            "sales-tax.csv",
            toCsv((taxQ.data ?? []).map((r) => ({ period: r.period, tax_dollars: (r.tax / 100).toFixed(2) }))),
          )
        }
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={taxQ.data ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E0D4CC" />
            <XAxis dataKey="period" stroke="#6E5E54" fontSize={11} />
            <YAxis stroke="#6E5E54" fontSize={11} tickFormatter={(v) => `$${(v / 100).toFixed(0)}`} />
            <Tooltip formatter={(v: any) => money(Number(v))} />
            <Line type="monotone" dataKey="tax" stroke="#7E9EA2" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </ReportCard>

      <ReportCard
        title="Outstanding Balances"
        description="Invoices not fully paid"
        onExport={() => downloadCsv("outstanding.csv", toCsv(outstandingQ.data ?? []))}
      >
        <SimpleTable
          rows={outstandingQ.data ?? []}
          columns={[
            { key: "invoice_number", label: "Invoice #" },
            { key: "owner", label: "Owner" },
            { key: "total", label: "Total", format: money },
            { key: "paid", label: "Paid", format: money },
            { key: "balance", label: "Balance", format: money },
            { key: "status", label: "Status" },
          ]}
        />
      </ReportCard>

      <ReportCard
        title="Refund Report"
        onExport={() => downloadCsv("refunds.csv", toCsv(refundsQ.data ?? []))}
      >
        <SimpleTable
          rows={refundsQ.data ?? []}
          columns={[
            { key: "processed_at", label: "Date", format: (v) => (v ? format(new Date(v), "MMM d, yyyy") : "—") },
            { key: "invoice_number", label: "Invoice" },
            { key: "owner", label: "Owner" },
            { key: "method", label: "Method" },
            { key: "amount", label: "Amount", format: money },
          ]}
        />
      </ReportCard>

      <ReportCard
        title="Deposit Report"
        description="Deposits in selected period"
        onExport={() => downloadCsv("deposits.csv", toCsv(depositsQ.data?.rows ?? []))}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(["pending", "paid", "refunded", "forfeited"] as const).map((s) => (
            <div key={s} className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{s}</div>
              <div className="mt-1 font-display text-lg">{money(depositsQ.data?.totals[s] ?? 0)}</div>
            </div>
          ))}
        </div>
        <SimpleTable
          rows={depositsQ.data?.rows ?? []}
          columns={[
            { key: "created_at", label: "Created", format: (v) => format(new Date(v), "MMM d, yyyy") },
            { key: "owner", label: "Owner" },
            { key: "amount", label: "Amount", format: money },
            { key: "status", label: "Status" },
          ]}
        />
      </ReportCard>

      <ReportCard
        title="Package Sales"
        onExport={() => downloadCsv("packages.csv", toCsv(pkgQ.data?.grouped ?? []))}
      >
        <SimpleTable
          rows={pkgQ.data?.grouped ?? []}
          columns={[
            { key: "package_id", label: "Package ID" },
            { key: "count", label: "Sold" },
          ]}
        />
      </ReportCard>
    </div>
  );
}

// ===== RESERVATIONS =====
function ReservationsTab({ orgId, range }: { orgId: string; range: R.DateRange }) {
  const occQ = useQuery({
    queryKey: ["rep-occ", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: () => R.fetchOccupancyByDay(orgId, range),
  });
  const noShowQ = useQuery({
    queryKey: ["rep-noshow", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: () => R.fetchNoShows(orgId, range),
  });
  const cancQ = useQuery({
    queryKey: ["rep-canc", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: () => R.fetchCancellations(orgId, range),
  });
  const svcQ = useQuery({
    queryKey: ["rep-svc", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: () => R.fetchServiceTypeComparison(orgId, range),
  });
  const futureQ = useQuery({ queryKey: ["rep-future", orgId], queryFn: () => R.fetchFutureReservations(orgId) });
  const standingQ = useQuery({ queryKey: ["rep-standing", orgId], queryFn: () => R.fetchStandingReservations(orgId) });
  const avgQ = useQuery({
    queryKey: ["rep-avg", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: () => R.fetchAvgPetsPerWeek(orgId, range),
  });

  return (
    <div className="space-y-6">
      <ReportCard
        title="Occupancy by Day"
        description="Active reservations per day"
        onExport={() => downloadCsv("occupancy.csv", toCsv(occQ.data ?? []))}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={occQ.data ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E0D4CC" />
            <XAxis dataKey="day" stroke="#6E5E54" fontSize={11} />
            <YAxis stroke="#6E5E54" fontSize={11} />
            <Tooltip />
            <Bar dataKey="count" fill="#C7D0C5" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ReportCard>

      <ReportCard
        title="No-Shows by Owner"
        onExport={() => downloadCsv("no-shows.csv", toCsv(noShowQ.data?.byOwner ?? []))}
      >
        <SimpleTable
          rows={noShowQ.data?.byOwner ?? []}
          columns={[
            { key: "owner", label: "Owner" },
            { key: "email", label: "Email" },
            { key: "count", label: "No-Shows" },
          ]}
        />
      </ReportCard>

      <ReportCard
        title="Cancellation Report"
        onExport={() => downloadCsv("cancellations.csv", toCsv(cancQ.data?.rows ?? []))}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={cancQ.data?.reasons ?? []} dataKey="count" nameKey="reason" cx="50%" cy="50%" outerRadius={80} label>
                {(cancQ.data?.reasons ?? []).map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          <SimpleTable
            rows={cancQ.data?.reasons ?? []}
            columns={[
              { key: "reason", label: "Reason" },
              { key: "count", label: "Count" },
            ]}
          />
        </div>
      </ReportCard>

      <ReportCard
        title="Service Type Comparison"
        onExport={() => downloadCsv("services.csv", toCsv(svcQ.data ?? []))}
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={svcQ.data ?? []} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#E0D4CC" />
            <XAxis type="number" stroke="#6E5E54" fontSize={11} />
            <YAxis dataKey="service" type="category" stroke="#6E5E54" fontSize={11} width={140} />
            <Tooltip />
            <Bar dataKey="count" fill="#CBA48F" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ReportCard>

      <ReportCard
        title="Future Reservations by Week"
        description="Next 3 months (confirmed + requested)"
        onExport={() => downloadCsv("future.csv", toCsv(futureQ.data ?? []))}
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={futureQ.data ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E0D4CC" />
            <XAxis dataKey="week" stroke="#6E5E54" fontSize={11} />
            <YAxis stroke="#6E5E54" fontSize={11} />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke="#CBA48F" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </ReportCard>

      <ReportCard
        title="Active Standing Reservations"
        onExport={() => downloadCsv("standing.csv", toCsv((standingQ.data ?? []).map((s: any) => ({
          id: s.id,
          owner: s.owners ? `${s.owners.first_name} ${s.owners.last_name}` : "—",
          start_date: s.start_date,
          end_date: s.end_date ?? "",
          days: (s.days_of_week ?? []).join("/"),
        }))))}
      >
        <SimpleTable
          rows={(standingQ.data ?? []).map((s: any) => ({
            owner: s.owners ? `${s.owners.first_name} ${s.owners.last_name}` : "—",
            start_date: s.start_date,
            end_date: s.end_date ?? "—",
            days: (s.days_of_week ?? []).join(", "),
            pets: (s.pet_ids ?? []).length,
          }))}
          columns={[
            { key: "owner", label: "Owner" },
            { key: "start_date", label: "Start" },
            { key: "end_date", label: "End" },
            { key: "days", label: "Days of Week" },
            { key: "pets", label: "# Pets" },
          ]}
        />
      </ReportCard>

      <ReportCard
        title="Average Pets per Week"
        onExport={() => downloadCsv("avg-pets.csv", toCsv(avgQ.data ?? []))}
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={avgQ.data ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E0D4CC" />
            <XAxis dataKey="week" stroke="#6E5E54" fontSize={11} />
            <YAxis stroke="#6E5E54" fontSize={11} />
            <Tooltip />
            <Line type="monotone" dataKey="pets" stroke="#7B3F7D" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </ReportCard>
    </div>
  );
}

// ===== OWNERS =====
function OwnersTab({ orgId, range }: { orgId: string; range: R.DateRange }) {
  const [bucket, setBucket] = useState<R.Bucket>("week");
  const newQ = useQuery({
    queryKey: ["rep-newowners", orgId, range.from.toISOString(), range.to.toISOString(), bucket],
    queryFn: () => R.fetchNewCustomers(orgId, range, bucket),
  });
  const subsQ = useQuery({ queryKey: ["rep-subs", orgId], queryFn: () => R.fetchActiveSubscriptions(orgId) });
  const spendQ = useQuery({
    queryKey: ["rep-spend", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: () => R.fetchOwnerSpend(orgId, range),
  });

  return (
    <div className="space-y-6">
      <ReportCard
        title="New Customers"
        onExport={() => downloadCsv("new-customers.csv", toCsv(newQ.data?.rows ?? []))}
      >
        <div className="mb-3">
          <Select value={bucket} onValueChange={(v: R.Bucket) => setBucket(v)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={newQ.data?.chart ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E0D4CC" />
            <XAxis dataKey="period" stroke="#6E5E54" fontSize={11} />
            <YAxis stroke="#6E5E54" fontSize={11} />
            <Tooltip />
            <Bar dataKey="count" fill="#F2D3C9" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3">
          <SimpleTable
            rows={newQ.data?.rows ?? []}
            columns={[
              { key: "first_name", label: "First" },
              { key: "last_name", label: "Last" },
              { key: "email", label: "Email" },
              { key: "created_at", label: "Joined", format: (v) => format(new Date(v), "MMM d, yyyy") },
            ]}
          />
        </div>
      </ReportCard>

      <ReportCard
        title="Customer Sources"
        description="Referral / acquisition data not yet tracked. Add a 'source' field on the owner form to enable this report."
      >
        <div className="py-6 text-center text-sm text-text-secondary">
          Coming soon — requires owner.source field.
        </div>
      </ReportCard>

      <ReportCard
        title="Active Subscriptions"
        onExport={() =>
          downloadCsv(
            "subscriptions.csv",
            toCsv((subsQ.data ?? []).map((s: any) => ({
              owner: s.owners ? `${s.owners.first_name} ${s.owners.last_name}` : "—",
              email: s.owners?.email ?? "",
              package_id: s.package_id,
              purchased_at: s.purchased_at,
              next_billing: s.next_billing_date ?? "",
            }))),
          )
        }
      >
        <SimpleTable
          rows={(subsQ.data ?? []).map((s: any) => ({
            owner: s.owners ? `${s.owners.first_name} ${s.owners.last_name}` : "—",
            email: s.owners?.email ?? "",
            package_id: s.package_id,
            purchased_at: s.purchased_at,
            next_billing: s.next_billing_date ?? "—",
          }))}
          columns={[
            { key: "owner", label: "Owner" },
            { key: "email", label: "Email" },
            { key: "package_id", label: "Package" },
            { key: "purchased_at", label: "Purchased", format: (v) => format(new Date(v), "MMM d, yyyy") },
            { key: "next_billing", label: "Next billing" },
          ]}
        />
      </ReportCard>

      <ReportCard
        title="Owner Spend Report"
        description="Top spenders in selected period"
        onExport={() => downloadCsv("owner-spend.csv", toCsv(spendQ.data ?? []))}
      >
        <SimpleTable
          rows={spendQ.data ?? []}
          columns={[
            { key: "owner", label: "Owner" },
            { key: "email", label: "Email" },
            { key: "visits", label: "Visits" },
            { key: "total", label: "Total Spent", format: money },
            { key: "avg", label: "Avg / Visit", format: money },
          ]}
        />
      </ReportCard>
    </div>
  );
}

// ===== PETS =====
function PetsTab({ orgId, range }: { orgId: string; range: R.DateRange }) {
  const vaxQ = useQuery({ queryKey: ["rep-vax", orgId], queryFn: () => R.fetchVaccineExpirations(orgId) });
  const bdayQ = useQuery({ queryKey: ["rep-bdays", orgId], queryFn: () => R.fetchBirthdaysThisMonth(orgId) });
  const incQ = useQuery({
    queryKey: ["rep-inc", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: () => R.fetchIncidentReport(orgId, range),
  });

  const vaxBuckets = useMemo(() => {
    const rows = vaxQ.data ?? [];
    return [
      { label: "≤30 days", count: rows.filter((r) => r.bucket === "30").length },
      { label: "31-60 days", count: rows.filter((r) => r.bucket === "60").length },
      { label: "61-90 days", count: rows.filter((r) => r.bucket === "90").length },
    ];
  }, [vaxQ.data]);

  return (
    <div className="space-y-6">
      <ReportCard
        title="Vaccination Expirations"
        description="Pets with vaccines expiring in the next 90 days"
        onExport={() => downloadCsv("vaccine-expirations.csv", toCsv(vaxQ.data ?? []))}
      >
        <div className="mb-4 grid grid-cols-3 gap-3">
          {vaxBuckets.map((b) => (
            <div key={b.label} className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{b.label}</div>
              <div className="mt-1 font-display text-2xl">{b.count}</div>
            </div>
          ))}
        </div>
        <SimpleTable
          rows={vaxQ.data ?? []}
          columns={[
            { key: "pet", label: "Pet" },
            { key: "vaccine", label: "Vaccine" },
            { key: "expires_on", label: "Expires" },
            { key: "days", label: "Days Left" },
          ]}
        />
      </ReportCard>

      <ReportCard
        title="Birthdays this Month"
        onExport={() => downloadCsv("birthdays.csv", toCsv(bdayQ.data ?? []))}
      >
        <SimpleTable
          rows={bdayQ.data ?? []}
          columns={[
            { key: "name", label: "Pet" },
            { key: "species", label: "Species" },
            { key: "breed", label: "Breed" },
            { key: "date_of_birth", label: "Born" },
          ]}
        />
      </ReportCard>

      <ReportCard
        title="Incident Report"
        onExport={() => downloadCsv("incidents.csv", toCsv(incQ.data?.rows ?? []))}
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {(incQ.data?.bySeverity ?? []).map((s) => (
            <Badge key={s.severity} variant="outline">
              {s.severity}: {s.count}
            </Badge>
          ))}
        </div>
        <SimpleTable
          rows={incQ.data?.rows ?? []}
          columns={[
            { key: "incident_at", label: "Date", format: (v) => format(new Date(v), "MMM d, yyyy") },
            { key: "incident_type", label: "Type" },
            { key: "severity", label: "Severity" },
            { key: "description", label: "Description" },
            { key: "owner_notified", label: "Owner Notified", format: (v) => (v ? "Yes" : "No") },
          ]}
        />
      </ReportCard>
    </div>
  );
}

export default function Reports() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const [range, setRange] = useState<R.DateRange>(R.presets.last30());

  if (!orgId) {
    return (
      <PortalLayout>
        <PageHeader title="Reports" />
        <div className="text-text-secondary">Loading…</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <PageHeader
        title="Reports"
        description="Financial, reservation, owner and pet insights for your business."
        actions={<RangePicker range={range} onChange={setRange} />}
      />

      <Tabs defaultValue="financial">
        <TabsList>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="reservations">Reservations</TabsTrigger>
          <TabsTrigger value="owners">Owners</TabsTrigger>
          <TabsTrigger value="pets">Pets</TabsTrigger>
        </TabsList>
        <TabsContent value="financial" className="mt-6">
          <FinancialTab orgId={orgId} range={range} />
        </TabsContent>
        <TabsContent value="reservations" className="mt-6">
          <ReservationsTab orgId={orgId} range={range} />
        </TabsContent>
        <TabsContent value="owners" className="mt-6">
          <OwnersTab orgId={orgId} range={range} />
        </TabsContent>
        <TabsContent value="pets" className="mt-6">
          <PetsTab orgId={orgId} range={range} />
        </TabsContent>
      </Tabs>
    </PortalLayout>
  );
}
