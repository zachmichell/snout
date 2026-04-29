import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReservationIncidents } from "@/hooks/useIncidents";
import {
  INCIDENT_SEVERITIES,
  SEVERITY_BADGE,
  incidentTypeStaffLabel,
  type IncidentSeverity,
} from "@/lib/incidents";
import { formatDateTime } from "@/lib/money";
import { cn } from "@/lib/utils";

export default function ReservationIncidentsSection({
  reservationId,
  petIds,
}: {
  reservationId: string;
  petIds: string[];
}) {
  const navigate = useNavigate();
  const { data: incidents, isLoading } = useReservationIncidents(reservationId);

  const onReport = () => {
    const params = new URLSearchParams({ reservation: reservationId });
    if (petIds.length) params.set("pets", petIds.join(","));
    navigate(`/incidents/new?${params.toString()}`);
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-text-tertiary" />
          <div className="label-eyebrow">Incidents</div>
        </div>
        <Button size="sm" variant="outline" onClick={onReport}>
          <Plus className="h-4 w-4" /> Report incident
        </Button>
      </div>

      {isLoading ? (
        <p className="mt-3 text-sm text-text-secondary">Loading…</p>
      ) : !incidents || incidents.length === 0 ? (
        <p className="mt-3 text-sm text-text-secondary">No incidents recorded for this reservation.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border-subtle">
          {incidents.map((inc: any) => (
            <li key={inc.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">
                    {incidentTypeStaffLabel(inc.incident_type)}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold",
                      SEVERITY_BADGE[inc.severity as IncidentSeverity],
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                    {INCIDENT_SEVERITIES.find((s) => s.value === inc.severity)?.label}
                  </span>
                  <span className="text-xs text-text-tertiary">{formatDateTime(inc.incident_at)}</span>
                </div>
                <p className="mt-1 text-sm text-text-secondary line-clamp-2">{inc.description}</p>
              </div>
              <Link
                to={`/incidents/${inc.id}`}
                className="text-xs font-semibold text-primary hover:underline"
              >
                View →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
