import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Pencil, Check } from "lucide-react";
import { toast } from "sonner";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { useIncident } from "@/hooks/useIncidents";
import { supabase } from "@/integrations/supabase/client";
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
import { usePermissions } from "@/hooks/usePermissions";

export default function IncidentDetail() {
  const { can } = usePermissions();
  const canEdit = can("incidents.edit");
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useIncident(id);
  const i = data as any;

  if (isLoading) {
    return (
      <PortalLayout>
        <div className="p-8 text-sm text-text-secondary">Loading…</div>
      </PortalLayout>
    );
  }
  if (!i) {
    return (
      <PortalLayout>
        <div className="p-8 text-sm text-text-secondary">Incident not found.</div>
      </PortalLayout>
    );
  }

  const reporter = (i as any).reporter
    ? `${(i as any).reporter.first_name ?? ""} ${(i as any).reporter.last_name ?? ""}`.trim()
    : null;
  const followUpDone = !!i.follow_up_completed_at;

  const markFollowUpComplete = async () => {
    const { error } = await supabase
      .from("incidents")
      .update({ follow_up_completed_at: new Date().toISOString() })
      .eq("id", i.id);
    if (error) return toast.error(error.message);
    toast.success("Follow-up marked complete");
    qc.invalidateQueries({ queryKey: ["incident", i.id] });
    qc.invalidateQueries({ queryKey: ["incidents"] });
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6 max-w-4xl">
        <Button variant="ghost" size="sm" onClick={() => navigate("/incidents")} className="mb-3 -ml-2">
          <ChevronLeft className="h-4 w-4" /> All incidents
        </Button>
        <PageHeader
          title={incidentTypeStaffLabel(i.incident_type)}
          description={
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold",
                  SEVERITY_BADGE[i.severity as IncidentSeverity],
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                {INCIDENT_SEVERITIES.find((s) => s.value === i.severity)?.label}
              </span>
              <span className="text-sm text-text-secondary">{formatDateTime(i.incident_at)}</span>
            </div>
          }
          actions={
            <>
              {i.follow_up_required && !followUpDone && (
                <Button onClick={markFollowUpComplete}>
                  <Check className="h-4 w-4" /> Mark follow-up complete
                </Button>
              )}
              {canEdit && (
                <Button variant="outline" onClick={() => navigate(`/incidents/${i.id}/edit`)}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              )}
            </>
          }
        />

        <div className="space-y-6">
          <Section title="What happened">
            <p className="whitespace-pre-wrap text-sm text-foreground">{i.description}</p>
            {i.action_taken && (
              <>
                <div className="label-eyebrow mt-5 mb-1.5">Action taken</div>
                <p className="whitespace-pre-wrap text-sm text-foreground">{i.action_taken}</p>
              </>
            )}
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border-subtle pt-4 text-sm">
              <Field label="Reporter" value={reporter ?? "—"} />
              <Field label="Location" value={(i as any).locations?.name ?? "—"} />
              {(i as any).reservations && (
                <div>
                  <dt className="text-xs text-text-tertiary">Linked reservation</dt>
                  <dd>
                    <Link
                      to={`/reservations/${(i as any).reservations.id}`}
                      className="text-primary hover:underline"
                    >
                      {(i as any).reservations.services?.name ?? "Reservation"} ·{" "}
                      {formatDateTime((i as any).reservations.start_at)}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </Section>

          <Section title={`Pets involved (${(i as any).incident_pets?.length ?? 0})`}>
            <ul className="space-y-2">
              {((i as any).incident_pets ?? []).map((ip: any) => {
                const meta = roleMeta(ip.role as IncidentRole);
                return (
                  <li
                    key={ip.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-subtle bg-background p-3"
                  >
                    <div className="flex items-center gap-3">
                      {ip.pets?.photo_url ? (
                        <img src={ip.pets.photo_url} alt={ip.pets.name} className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-primary-light" />
                      )}
                      <div>
                        <Link
                          to={`/pets/${ip.pet_id}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {ip.pets?.name ?? "Pet"}
                        </Link>
                        {ip.injury_description && (
                          <div className="text-xs text-text-secondary">Injury: {ip.injury_description}</div>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold",
                        meta.tone,
                      )}
                    >
                      {meta.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>

          {i.follow_up_required && (
            <Section title="Follow-up">
              <div className="text-sm">
                <div>
                  Status:{" "}
                  {followUpDone ? (
                    <span className="text-success font-semibold">
                      Completed {formatDateTime(i.follow_up_completed_at)}
                    </span>
                  ) : (
                    <span className="text-warning font-semibold">Open</span>
                  )}
                </div>
                {i.follow_up_notes && (
                  <p className="mt-3 whitespace-pre-wrap text-foreground">{i.follow_up_notes}</p>
                )}
              </div>
            </Section>
          )}

          <Section title="Owner communication">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Field
                label="Owner notified"
                value={i.owner_notified ? `Yes — ${formatDateTime(i.owner_notified_at)}` : "Not notified"}
              />
              <Field label="Visible in owner portal" value={i.owner_visible ? "Yes" : "No"} />
            </dl>
          </Section>
        </div>
      </div>
    </PortalLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="font-display text-base mb-4 text-foreground">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-tertiary">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
