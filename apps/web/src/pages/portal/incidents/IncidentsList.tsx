import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { CalendarIcon, Plus, Flag, AlertTriangle } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useIncidents } from "@/hooks/useIncidents";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  SEVERITY_BADGE,
  incidentTypeStaffLabel,
  type IncidentSeverity,
  type IncidentType,
} from "@/lib/incidents";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/money";
import { usePermissions } from "@/hooks/usePermissions";

export default function IncidentsList() {
  const { membership } = useAuth();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canCreate = can("incidents.create");

  const [from, setFrom] = useState<Date>(subDays(new Date(), 30));
  const [to, setTo] = useState<Date>(new Date());
  const [severity, setSeverity] = useState<IncidentSeverity | "all">("all");
  const [type, setType] = useState<IncidentType | "all">("all");
  const [followUpOnly, setFollowUpOnly] = useState(false);

  const filters = useMemo(
    () => ({
      organizationId: membership?.organization_id,
      from: from.toISOString(),
      to: new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
      severity,
      type,
      followUpOnly,
    }),
    [membership?.organization_id, from, to, severity, type, followUpOnly],
  );

  const { data: incidents, isLoading } = useIncidents(filters);

  const openFollowUps = (incidents ?? []).filter(
    (i: any) => i.follow_up_required && !i.follow_up_completed_at,
  ).length;

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Incident Log"
          description={
            openFollowUps > 0
              ? `${openFollowUps} open follow-up${openFollowUps === 1 ? "" : "s"}`
              : "All incidents resolved or no follow-ups required"
          }
          actions={
            canCreate ? (
              <Button onClick={() => navigate("/incidents/new")}>
                <Plus className="h-4 w-4" /> New Incident
              </Button>
            ) : null
          }
        />

        {/* Filters */}
        <div className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">From</Label>
            <DateButton value={from} onChange={setFrom} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">To</Label>
            <DateButton value={to} onChange={setTo} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Severity</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as any)}>
              <SelectTrigger className="w-36 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {INCIDENT_SEVERITIES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger className="w-44 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {INCIDENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.staff}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 self-end pb-2">
            <Switch id="followup" checked={followUpOnly} onCheckedChange={setFollowUpOnly} />
            <Label htmlFor="followup" className="text-sm">Open follow-ups only</Label>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background text-left">
                <th className="px-[18px] py-[12px] label-eyebrow">Date / Time</th>
                <th className="px-[18px] py-[12px] label-eyebrow">Type</th>
                <th className="px-[18px] py-[12px] label-eyebrow">Severity</th>
                <th className="px-[18px] py-[12px] label-eyebrow">Pets</th>
                <th className="px-[18px] py-[12px] label-eyebrow">Description</th>
                <th className="px-[18px] py-[12px] label-eyebrow text-center">Follow-up</th>
                <th className="px-[18px] py-[12px] label-eyebrow">Reporter</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-text-secondary">Loading…</td>
                </tr>
              ) : !incidents || incidents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <p className="font-display text-base text-foreground">No incidents reported</p>
                    <p className="mt-1 text-sm text-text-secondary">Nothing to follow up on in this date range. Keep up the good work.</p>
                  </td>
                </tr>
              ) : (
                incidents.map((i: any) => {
                  const pets = (i.incident_pets ?? []).map((p: any) => p.pets?.name).filter(Boolean).join(", ");
                  const openFlag = i.follow_up_required && !i.follow_up_completed_at;
                  const reporter = i.reporter
                    ? `${i.reporter.first_name ?? ""} ${i.reporter.last_name ?? ""}`.trim()
                    : "—";
                  return (
                    <tr
                      key={i.id}
                      onClick={() => navigate(`/incidents/${i.id}`)}
                      className="cursor-pointer border-t border-border-subtle hover:bg-background"
                    >
                      <td className="px-[18px] py-[12px] text-text-secondary whitespace-nowrap">
                        {formatDateTime(i.incident_at)}
                      </td>
                      <td className="px-[18px] py-[12px] font-medium text-foreground">
                        {incidentTypeStaffLabel(i.incident_type)}
                      </td>
                      <td className="px-[18px] py-[12px]">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold",
                            SEVERITY_BADGE[i.severity as IncidentSeverity],
                          )}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                          {INCIDENT_SEVERITIES.find((s) => s.value === i.severity)?.label}
                        </span>
                      </td>
                      <td className="px-[18px] py-[12px] text-foreground">{pets || "—"}</td>
                      <td className="px-[18px] py-[12px] text-text-secondary max-w-[280px] truncate">
                        {i.description}
                      </td>
                      <td className="px-[18px] py-[12px] text-center">
                        {openFlag ? (
                          <Flag className="mx-auto h-4 w-4 text-warning" />
                        ) : i.follow_up_required ? (
                          <span className="text-xs text-success">Done</span>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-[18px] py-[12px] text-text-secondary">{reporter}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PortalLayout>
  );
}

function DateButton({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-40 justify-start font-normal">
          <CalendarIcon className="h-4 w-4" />
          {format(value, "MMM d, yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => d && onChange(d)}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
