import { usePetIncidents } from "@/hooks/useIncidents";
import { incidentTypeOwnerLabel, SEVERITY_OWNER_ACCENT, type IncidentSeverity } from "@/lib/incidents";
import { formatDateTime } from "@/lib/money";
import { cn } from "@/lib/utils";

export default function PetIncidentsOwnerSection({ petId, petName }: { petId: string; petName: string }) {
  const { data: all, isLoading } = usePetIncidents(petId);
  // RLS already filters to owner_visible=true via the policy, but double-guard.
  const incidents = (all ?? []).filter((i: any) => i.owner_visible === true);

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 className="font-display text-xl font-semibold text-foreground">Incident reports</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        We keep you informed about anything that happens during {petName}'s visits.
      </p>

      {isLoading ? (
        <p className="mt-5 text-sm text-muted-foreground">Loading…</p>
      ) : incidents.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No incidents to report — {petName} has been great!
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {incidents.map((inc: any) => (
            <article
              key={inc.id}
              className={cn(
                "rounded-xl border border-border-subtle bg-background p-4 border-l-4",
                SEVERITY_OWNER_ACCENT[inc.severity as IncidentSeverity],
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-foreground">{incidentTypeOwnerLabel(inc.incident_type)}</h3>
                <span className="text-xs text-muted-foreground">{formatDateTime(inc.incident_at)}</span>
              </div>
              <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">{inc.description}</p>
              {inc.action_taken && (
                <div className="mt-2 rounded-md bg-muted/50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    What we did
                  </div>
                  <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{inc.action_taken}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
