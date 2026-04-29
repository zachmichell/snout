import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Archive } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import ModuleBadge from "@/components/portal/ModuleBadge";
import StatusBadge from "@/components/portal/StatusBadge";
import ReservationStatusBadge from "@/components/portal/ReservationStatusBadge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatCentsShort, formatDurationType, formatDateTime } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";

export default function ServiceDetail() {
  const { can } = usePermissions();
  const canManage = can("services.manage");
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: service, isLoading } = useQuery({
    queryKey: ["service", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*, locations(name, timezone)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: reservations } = useQuery({
    queryKey: ["service-reservations", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select(
          "id, start_at, status, source, primary_owner_id, owners:primary_owner_id(first_name, last_name), reservation_pets(pet_id, pets(name))",
        )
        .eq("service_id", id!)
        .is("deleted_at", null)
        .order("start_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleArchive = async () => {
    if (!service) return;
    if (!confirm(`Archive "${service.name}"? It will be hidden from new bookings.`)) return;
    const { error } = await supabase
      .from("services")
      .update({ deleted_at: new Date().toISOString(), active: false })
      .eq("id", service.id);
    if (error) return toast.error(error.message);
    toast.success("Service archived");
    qc.invalidateQueries({ queryKey: ["services"] });
    navigate("/services");
  };

  if (isLoading) {
    return (
      <PortalLayout>
        <div className="p-8 text-sm text-text-secondary">Loading…</div>
      </PortalLayout>
    );
  }

  if (!service) {
    return (
      <PortalLayout>
        <div className="p-8 text-sm text-text-secondary">Service not found.</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title={service.name}
          description={
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ModuleBadge module={service.module} />
              <StatusBadge tone="muted">{formatDurationType(service.duration_type)}</StatusBadge>
              <span className="text-sm text-text-secondary">
                {(service as any).locations?.name ?? "—"}
              </span>
              {service.active ? (
                <StatusBadge tone="success">Active</StatusBadge>
              ) : (
                <StatusBadge tone="muted">Inactive</StatusBadge>
              )}
            </div>
          }
          actions={
            canManage ? (
              <>
                <Button variant="outline" onClick={() => navigate(`/services/${service.id}/edit`)}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
                <Button variant="outline" onClick={handleArchive}>
                  <Archive className="h-4 w-4" /> Archive
                </Button>
              </>
            ) : null
          }
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
              <div className="label-eyebrow mb-3">Details</div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-text-tertiary text-xs">Base Price</dt>
                  <dd className="text-foreground font-medium">{formatCentsShort(service.base_price_cents)}</dd>
                </div>
                <div>
                  <dt className="text-text-tertiary text-xs">Max Pets Per Booking</dt>
                  <dd className="text-foreground">{(service as any).max_pets_per_booking ?? "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-text-tertiary text-xs">Description</dt>
                  <dd className="text-foreground whitespace-pre-wrap">{service.description ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-text-tertiary text-xs">Created</dt>
                  <dd className="text-text-secondary">{formatDate(service.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-text-tertiary text-xs">Updated</dt>
                  <dd className="text-text-secondary">{formatDate(service.updated_at)}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-border bg-surface shadow-card">
              <div className="border-b border-border-subtle px-6 py-4">
                <div className="font-display text-base text-foreground">Reservations</div>
              </div>
              {!reservations || reservations.length === 0 ? (
                <div className="p-6 text-sm text-text-secondary">No reservations yet for this service.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background text-left">
                      <th className="px-[18px] py-[12px] label-eyebrow">Date</th>
                      <th className="px-[18px] py-[12px] label-eyebrow">Owner</th>
                      <th className="px-[18px] py-[12px] label-eyebrow">Pets</th>
                      <th className="px-[18px] py-[12px] label-eyebrow">Status</th>
                      <th className="px-[18px] py-[12px] label-eyebrow">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reservations.map((r: any) => (
                      <tr key={r.id} className="border-t border-border-subtle hover:bg-background">
                        <td className="px-[18px] py-[12px]">
                          <Link to={`/reservations/${r.id}`} className="text-foreground hover:text-primary">
                            {formatDateTime(r.start_at, (service as any).locations?.timezone)}
                          </Link>
                        </td>
                        <td className="px-[18px] py-[12px] text-text-secondary">
                          {r.owners ? `${r.owners.first_name} ${r.owners.last_name}` : "—"}
                        </td>
                        <td className="px-[18px] py-[12px] text-text-secondary">
                          {(r.reservation_pets ?? []).map((rp: any) => rp.pets?.name).filter(Boolean).join(", ") ||
                            "—"}
                        </td>
                        <td className="px-[18px] py-[12px]">
                          <ReservationStatusBadge status={r.status} />
                        </td>
                        <td className="px-[18px] py-[12px] text-text-secondary text-xs">
                          {r.source === "owner_self_serve" ? "Owner" : "Staff"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
