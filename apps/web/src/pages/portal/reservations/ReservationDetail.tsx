import { useState } from "react";
import { toArray } from "@/lib/postgrest";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, CheckCircle2, LogIn, LogOut, XCircle, AlertTriangle, Plus, Trash2, FileHeart, Repeat } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import ReservationStatusBadge from "@/components/portal/ReservationStatusBadge";
import StatusBadge, { intakeTone } from "@/components/portal/StatusBadge";
import ReportCardEditor from "@/components/portal/pet-care/ReportCardEditor";
import ReservationIncidentsSection from "@/components/portal/ReservationIncidentsSection";
import { useReservationCareLogs } from "@/hooks/useCareLogs";
import { LOG_TYPE_LABELS, LogType } from "@/lib/care";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatCentsShort, formatDateTime, formatDurationType } from "@/lib/money";
import { createInvoiceForReservation } from "@/lib/invoice";
import { sendReservationConfirmation } from "@/lib/email";
import { usePermissions } from "@/hooks/usePermissions";
import { logActivity } from "@/lib/activity";
import { useLogActivity } from "@/hooks/useLogActivity";
import { ActivityLog } from "@/components/portal/ActivityLog";
import { ownerCreditSummary } from "@/components/portal/ReservationCells";
import SwitchServiceDialog from "@/components/portal/SwitchServiceDialog";

export default function ReservationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, membership } = useAuth();
  const log = useLogActivity();
  const { can } = usePermissions();
  const canEdit = can("reservations.edit");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [addPetId, setAddPetId] = useState<string>("");
  const [reportPet, setReportPet] = useState<{ id: string; name: string } | null>(null);

  const { data: r, isLoading } = useQuery({
    queryKey: ["reservation", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select(
          `*,
           owners:primary_owner_id(id, first_name, last_name, email, phone, daycare_full_day_credits, daycare_half_day_credits, boarding_night_credits),
           services(id, name, module, duration_type, base_price_cents),
           suites:suite_id(name),
           locations(name, timezone),
           reservation_pets(id, pet_id, pets(id, name, species, breed, photo_url, intake_status)),
           add_ons:reservations!parent_reservation_id(id, start_at, end_at, status, services:service_id(name, module))`,
        )
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: ownerPetsForAdd } = useQuery({
    queryKey: ["owner-pets-add", r?.primary_owner_id],
    enabled: !!r?.primary_owner_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_owners")
        .select("pet_id, pets(id, name)")
        .eq("owner_id", r!.primary_owner_id!);
      if (error) throw error;
      return (data ?? [])
        .map((row: any) => row.pets)
        .filter((p: any) => p) as { id: string; name: string }[];
    },
  });

  const { data: careLogs } = useReservationCareLogs(id);

  const { data: reportCards } = useQuery({
    queryKey: ["reservation-report-cards", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_cards")
        .select("id, pet_id, published")
        .eq("reservation_id", id!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["reservation", id] });

  const updateStatus = async (patch: Record<string, any>, label: string, action?: string) => {
    if (!r) return;
    const { error } = await supabase.from("reservations").update(patch as any).eq("id", r.id);
    if (error) return toast.error(error.message);
    if (r.organization_id && action) {
      await logActivity({
        organization_id: r.organization_id,
        action,
        entity_type: "reservation",
        entity_id: r.id,
        metadata: { status: patch.status },
      });
    }
    toast.success(label);
    refresh();
  };

  const handleConfirm = async () => {
    await updateStatus(
      { status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by_user_id: user?.id ?? null },
      "Reservation confirmed",
      "confirmed",
    );
    // Send confirmation email (fire-and-forget; respects email_settings)
    if (r) {
      const owner: any = (r as any).owners;
      const service: any = (r as any).services;
      const location: any = (r as any).locations;
      const pets: any[] = toArray((r as any).reservation_pets).map((rp: any) => rp.pets).filter(Boolean);
      if (owner?.email && r.organization_id) {
        sendReservationConfirmation({
          organization_id: r.organization_id,
          to: owner.email,
          pet_names: pets.map((p) => p.name),
          service_name: service?.name ?? "Booking",
          start_at: formatDateTime(r.start_at, location?.timezone),
          location_name: location?.name ?? "",
          reservation_id: r.id,
          owner_first_name: owner.first_name,
          owner_id: owner.id,
        }).catch((e) => console.warn("reservation email failed:", e));
      }
    }
  };
  const handleCheckIn = () =>
    updateStatus(
      {
        status: "checked_in",
        checked_in_at: new Date().toISOString(),
        checked_in_by_user_id: user?.id ?? null,
      },
      "Checked in",
      "checked_in",
    );
  const handleCheckOut = async () => {
    if (!r) return;
    await updateStatus(
      {
        status: "checked_out",
        checked_out_at: new Date().toISOString(),
        checked_out_by_user_id: user?.id ?? null,
      },
      "Checked out",
      "checked_out",
    );
    try {
      const inv = await createInvoiceForReservation(r.id);
      if (!inv.alreadyExisted) {
        toast.success(`Invoice ${inv.invoice_number ?? ""} created`, {
          action: {
            label: "View",
            onClick: () => navigate(`/invoices/${inv.id}`),
          },
        });
        if (r.organization_id) {
          await logActivity({
            organization_id: r.organization_id,
            action: "created",
            entity_type: "invoice",
            entity_id: inv.id,
            metadata: { reservation_id: r.id, invoice_number: inv.invoice_number },
          });
        }
      }
      qc.invalidateQueries({ queryKey: ["invoices-list"] });
    } catch (e: any) {
      toast.error(`Invoice creation failed: ${e.message ?? "unknown"}`);
    }
  };

  const handleCancelConfirm = async () => {
    if (!cancelReason.trim()) {
      toast.error("Please provide a reason");
      return;
    }
    await updateStatus(
      {
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_reason: cancelReason.trim(),
      },
      "Reservation cancelled",
      "cancelled",
    );
    setCancelOpen(false);
    setCancelReason("");
  };

  const handleNoShowConfirm = async () => {
    await updateStatus({ status: "no_show" }, "Marked as no-show", "marked_no_show");
    setNoShowOpen(false);
  };

  const addPet = async () => {
    if (!addPetId || !r || !membership) return;
    const { error } = await supabase.from("reservation_pets").insert({
      reservation_id: r.id,
      pet_id: addPetId,
      organization_id: membership.organization_id,
    });
    if (error) return toast.error(error.message);
    toast.success("Pet added");
    setAddPetId("");
    refresh();
  };

  const removePet = async (linkId: string) => {
    if (!r) return;
    if ((r as any).reservation_pets.length <= 1) {
      toast.error("A reservation must have at least one pet");
      return;
    }
    if (!confirm("Remove this pet from the reservation?")) return;
    const { error } = await supabase.from("reservation_pets").delete().eq("id", linkId);
    if (error) return toast.error(error.message);
    toast.success("Pet removed");
    refresh();
  };

  if (isLoading) {
    return (
      <PortalLayout>
        <div className="p-8 text-sm text-text-secondary">Loading…</div>
      </PortalLayout>
    );
  }
  if (!r) {
    return (
      <PortalLayout>
        <div className="p-8 text-sm text-text-secondary">Reservation not found.</div>
      </PortalLayout>
    );
  }

  const tz = (r as any).locations?.timezone || undefined;
  const linkedPetIds = new Set(toArray((r as any).reservation_pets).map((rp: any) => rp.pet_id));
  const addable = (ownerPetsForAdd ?? []).filter((p) => !linkedPetIds.has(p.id));

  // "Switch service" is allowed only before the pet has arrived. After
  // check-in or check-out the relevant accounting (credits, invoicing) has
  // already been keyed off the original service module and changing it
  // retroactively is its own can of worms.
  const canSwitchService = r.status === "requested" || r.status === "confirmed";

  const renderActions = () => {
    switch (r.status) {
      case "requested":
        return (
          <>
            <Button onClick={handleConfirm}>
              <CheckCircle2 className="h-4 w-4" /> Confirm
            </Button>
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              <XCircle className="h-4 w-4" /> Cancel
            </Button>
          </>
        );
      case "confirmed":
        return (
          <>
            <Button onClick={handleCheckIn}>
              <LogIn className="h-4 w-4" /> Check In
            </Button>
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              <XCircle className="h-4 w-4" /> Cancel
            </Button>
          </>
        );
      case "checked_in":
        return (
          <>
            <Button onClick={handleCheckOut}>
              <LogOut className="h-4 w-4" /> Check Out
            </Button>
            <Button variant="outline" onClick={() => setNoShowOpen(true)}>
              <AlertTriangle className="h-4 w-4" /> No Show
            </Button>
          </>
        );
      default:
        return null;
    }
  };

  // Switch service handler is now owned by SwitchServiceDialog. We
  // just trigger the dialog and refresh the page when it reports
  // a successful save.

  const titleService = (r as any).services?.name ?? "Reservation";
  const reservationPets = toArray((r as any).reservation_pets);
  const firstPet = reservationPets[0]?.pets;
  const extraPetCount = Math.max(0, reservationPets.length - 1);
  const headerTitle = firstPet?.name
    ? `${firstPet.name}${extraPetCount > 0 ? ` +${extraPetCount}` : ""}`
    : "Reservation";
  const owner = (r as any).owners;
  const ownerCredits = ownerCreditSummary(owner ?? null);

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title={headerTitle}
          description={
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <ReservationStatusBadge status={r.status} />
              <span className="text-text-secondary">
                {firstPet?.breed ? `${firstPet.breed} · ` : ""}
                {titleService}
                {" · "}
                {formatDateTime(r.start_at, tz)}
              </span>
              {owner && (
                <span className="ml-auto inline-flex items-center gap-2">
                  <Link
                    to={`/owners/${owner.id}`}
                    className="text-foreground hover:text-primary"
                  >
                    {owner.first_name} {owner.last_name}
                  </Link>
                  {ownerCredits && (
                    <span className="text-xs text-text-tertiary">{ownerCredits}</span>
                  )}
                </span>
              )}
            </div>
          }
          actions={
            <>
              {renderActions()}
              {(r.status === "checked_in" || r.status === "checked_out") && firstPet?.id && (
                <Button
                  variant="outline"
                  onClick={() => setReportPet({ id: firstPet.id, name: firstPet.name ?? "Pet" })}
                >
                  <FileHeart className="h-4 w-4" />
                  {(reportCards ?? []).find((c: any) => c.pet_id === firstPet.id)?.published
                    ? "Report Card"
                    : (reportCards ?? []).find((c: any) => c.pet_id === firstPet.id)
                      ? "Report Card · Draft"
                      : "Report Card"}
                </Button>
              )}
              {canEdit && canSwitchService && (
                <Button variant="outline" onClick={() => setSwitchOpen(true)}>
                  <Repeat className="h-4 w-4" /> Switch service
                </Button>
              )}
              {canEdit && r.status !== "checked_out" && r.status !== "cancelled" && r.status !== "no_show" && (
                <Button variant="outline" onClick={() => navigate(`/reservations/${r.id}/edit`)}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              )}
            </>
          }
        />

        <div className="mt-4">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
                  <div className="label-eyebrow mb-3">Booking</div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-text-tertiary">Service</dt>
                      <dd className="text-foreground">{(r as any).services?.name ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-tertiary">Duration</dt>
                      <dd className="text-foreground">
                        {formatDurationType((r as any).services?.duration_type ?? "")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-tertiary">Location</dt>
                      <dd className="text-foreground">{(r as any).locations?.name ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-tertiary">Base Price</dt>
                      <dd className="text-foreground">
                        {formatCentsShort((r as any).services?.base_price_cents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-tertiary">Start</dt>
                      <dd className="text-foreground">{formatDateTime(r.start_at, tz)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-tertiary">End</dt>
                      <dd className="text-foreground">{formatDateTime(r.end_at, tz)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-tertiary">Suite</dt>
                      <dd className="text-foreground">{(r as any).suites?.name ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-tertiary">Source</dt>
                      <dd>
                        <span className="inline-flex items-center rounded-pill border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
                          {r.source === "owner_self_serve" ? "Owner" : "Staff"}
                        </span>
                      </dd>
                    </div>
                  </dl>
                  {(r as any).add_ons?.length > 0 && (
                    <div className="mt-5 border-t border-border-subtle pt-4">
                      <div className="text-xs text-text-tertiary mb-2">Linked services</div>
                      <ul className="space-y-1.5 text-sm">
                        {((r as any).add_ons as Array<any>).map((a) => (
                          <li key={a.id} className="flex items-center justify-between">
                            <Link
                              to={`/reservations/${a.id}`}
                              className="font-medium text-foreground hover:text-primary"
                            >
                              {a.services?.name ?? "Service"}
                            </Link>
                            <span className="text-xs text-text-tertiary">
                              {formatDateTime(a.start_at, tz)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {r.notes && (
                    <div className="mt-5 border-t border-border-subtle pt-4">
                      <div className="text-xs text-text-tertiary mb-1">Notes</div>
                      <p className="whitespace-pre-wrap text-sm text-foreground">{r.notes}</p>
                    </div>
                  )}
                  {(r as any).cancelled_reason && (
                    <div className="mt-5 rounded-md border border-destructive/20 bg-destructive-light p-3">
                      <div className="text-xs font-semibold text-destructive">Cancellation reason</div>
                      <p className="mt-1 text-sm text-foreground">{(r as any).cancelled_reason}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
                  <div className="label-eyebrow mb-4">Status timeline</div>
                  <ol className="relative space-y-4 border-l border-border-subtle pl-4">
                    <Timeline label="Requested" at={(r as any).requested_at ?? r.created_at} />
                    <Timeline label="Confirmed" at={(r as any).confirmed_at} />
                    <Timeline label="Checked in" at={r.checked_in_at} />
                    <Timeline label="Checked out" at={r.checked_out_at} />
                    {(r as any).cancelled_at && <Timeline label="Cancelled" at={(r as any).cancelled_at} />}
                  </ol>
                </div>

                <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
                  <div className="label-eyebrow mb-3">Care log</div>
                  {!careLogs || careLogs.length === 0 ? (
                    <p className="text-sm text-text-secondary">No care logs yet.</p>
                  ) : (
                    <>
                      <p className="text-sm text-text-secondary">
                        {careLogs.length} entr{careLogs.length === 1 ? "y" : "ies"} —{" "}
                        {(["feeding", "play", "potty", "medication", "rest", "note"] as LogType[])
                          .map((t) => {
                            const n = careLogs.filter((l: any) => l.log_type === t).length;
                            return n > 0 ? `${n} ${LOG_TYPE_LABELS[t].toLowerCase()}` : null;
                          })
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                      <Link
                        to={`/care-logs?reservation=${r.id}`}
                        className="mt-2 inline-block text-xs font-semibold text-primary hover:underline"
                      >
                        View timeline →
                      </Link>
                    </>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
                  <div className="label-eyebrow mb-3">Activity</div>
                  <ActivityLog entityType="reservation" entityId={r.id} />
                </div>
              </div>
            </div>

            <div className="mt-6">
              <ReservationIncidentsSection
                reservationId={r.id}
                petIds={toArray((r as any).reservation_pets).map((rp: any) => rp.pet_id)}
              />
            </div>
        </div>
      </div>

      {/* Switch service modal — extracted to a portable component so the
          Dashboard rows can trigger the same flow inline. */}
      <SwitchServiceDialog
        open={switchOpen}
        onOpenChange={setSwitchOpen}
        reservationId={r.id}
        currentServiceId={r.service_id ?? null}
        currentServiceName={(r as any).services?.name ?? null}
        onSaved={refresh}
      />

      {/* Cancel modal */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel reservation</DialogTitle>
            <DialogDescription>
              Provide a reason for the cancellation. This will be saved on the reservation record.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            placeholder="Reason for cancellation"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Keep reservation
            </Button>
            <Button onClick={handleCancelConfirm}>Cancel reservation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* No-show confirm */}
      <AlertDialog open={noShowOpen} onOpenChange={setNoShowOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as no-show?</AlertDialogTitle>
            <AlertDialogDescription>
              This is a terminal status. The reservation cannot be reopened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleNoShowConfirm}>Mark no-show</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {reportPet && (
        <ReportCardEditor
          open={!!reportPet}
          onOpenChange={(o) => !o && setReportPet(null)}
          reservationId={r.id}
          petId={reportPet.id}
          petName={reportPet.name}
        />
      )}
    </PortalLayout>
  );
}

function Timeline({ label, at }: { label: string; at: string | null | undefined }) {
  const done = !!at;
  return (
    <li className="relative">
      <span
        className={`absolute -left-[22px] top-1 h-3 w-3 rounded-full border-2 ${
          done ? "border-primary bg-primary" : "border-border bg-background"
        }`}
      />
      <div className={`text-sm font-medium ${done ? "text-foreground" : "text-text-tertiary"}`}>{label}</div>
      <div className="text-xs text-text-secondary">{done ? formatDateTime(at) : "Pending"}</div>
    </li>
  );
}
