import { Link } from "react-router-dom";
import { usePetIncidents } from "@/hooks/useIncidents";
import { formatDateTime } from "@/lib/money";
import {
  INCIDENT_SEVERITIES,
  SEVERITY_BADGE,
  incidentTypeStaffLabel,
  roleMeta,
  type IncidentRole,
  type IncidentSeverity,
} from "@/lib/incidents";
import { cn } from "@/lib/utils";

export default function PetIncidentsSection({ petId }: { petId: string }) {
  const { data: incidents, isLoading } = usePetIncidents(petId);

  if (isLoading) {
    return <div className="p-6 text-sm text-text-secondary">Loading incidents…</div>;
  }
  if (!incidents || incidents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-text-secondary">
        No incidents recorded — keep it up!
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface shadow-card">
      <ul className="divide-y divide-border-subtle">
        {incidents.map((inc: any) => {
          const role = inc._thisPetRole as IncidentRole | undefined;
          const meta = role ? roleMeta(role) : null;
          return (
            <li key={inc.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{incidentTypeStaffLabel(inc.incident_type)}</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold",
                      SEVERITY_BADGE[inc.severity as IncidentSeverity],
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                    {INCIDENT_SEVERITIES.find((s) => s.value === inc.severity)?.label}
                  </span>
                  {meta && (
                    <span className={cn("inline-flex items-center rounded-pill border px-2 py-0.5 text-[10px] font-semibold", meta.tone)}>
                      {meta.label}
                    </span>
                  )}
                  <span className="text-xs text-text-tertiary">{formatDateTime(inc.incident_at)}</span>
                </div>
                <p className="mt-1 text-sm text-text-secondary line-clamp-2">{inc.description}</p>
              </div>
              <Link to={`/incidents/${inc.id}`} className="text-xs font-semibold text-primary hover:underline">
                View →
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
