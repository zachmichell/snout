import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PawPrint, CalendarDays, Receipt, ChevronRight, Plus, FileHeart, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { useOwnerReportCards } from "@/hooks/useReportCards";
import { useOwnerConversation } from "@/hooks/useConversations";
import { ratingMeta } from "@/lib/care";
import { formatDate, speciesIcon } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { formatRelativeTime, truncatePreview } from "@/lib/messaging";
import { getVaccinationStatus } from "@/lib/vaccines";
import VaccinationStatusBadge from "@/components/portal-owner/VaccinationStatusBadge";
import InvoiceStatusBadge from "@/components/portal/InvoiceStatusBadge";
import ReservationStatusBadge from "@/components/portal/ReservationStatusBadge";
import BookingWizard from "@/components/portal-owner/booking-wizard/BookingWizard";
import EnableNotificationsCard from "@/components/portal-owner/EnableNotificationsCard";
import { Button } from "@/components/ui/button";

export default function OwnerDashboard() {
  const { profile, membership } = useAuth();
  const [wizardOpen, setWizardOpen] = useState(false);
  const { data: owner, isLoading: ownerLoading } = useOwnerRecord();
  const { data: reportCards } = useOwnerReportCards(owner?.id);
  const { data: conversation } = useOwnerConversation(owner?.id);

  const { data: org } = useQuery({
    queryKey: ["owner-org", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", membership!.organization_id)
        .maybeSingle();
      return data;
    },
  });

  const { data: upcoming } = useQuery({
    queryKey: ["owner-upcoming", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("id, start_at, end_at, status, services(name), reservation_pets(pets(name))")
        .eq("primary_owner_id", owner!.id)
        .in("status", ["confirmed", "requested"])
        .gte("start_at", new Date().toISOString())
        .is("deleted_at", null)
        .order("start_at", { ascending: true })
        .limit(3);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: pets } = useQuery({
    queryKey: ["owner-pets", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_owners")
        .select(
          "pets(id, name, breed, species, photo_url, deleted_at, vaccinations(id, expires_on, deleted_at))",
        )
        .eq("owner_id", owner!.id);
      if (error) throw error;
      return (data ?? [])
        .map((row: any) => row.pets)
        .filter((p: any) => p && !p.deleted_at)
        .map((p: any) => ({
          ...p,
          vaccinations: (p.vaccinations ?? []).filter((v: any) => !v.deleted_at),
        }));
    },
  });

  const { data: invoices } = useQuery({
    queryKey: ["owner-invoices", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, total_cents, currency, due_at, status")
        .eq("owner_id", owner!.id)
        .in("status", ["sent", "overdue"])
        .is("deleted_at", null)
        .order("due_at", { ascending: true })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: waiverAlert } = useQuery({
    queryKey: ["owner-waivers-alert", owner?.id, membership?.organization_id],
    enabled: !!owner?.id && !!membership?.organization_id,
    queryFn: async () => {
      const [{ data: waivers }, { data: signatures }] = await Promise.all([
        supabase
          .from("waivers")
          .select("id, version")
          .eq("organization_id", membership!.organization_id)
          .eq("active", true)
          .is("deleted_at", null),
        supabase
          .from("waiver_signatures")
          .select("waiver_id, waiver_version, signed_at")
          .eq("owner_id", owner!.id)
          .order("signed_at", { ascending: false }),
      ]);
      const latest = new Map<string, number>();
      for (const s of signatures ?? []) {
        if (!latest.has(s.waiver_id)) latest.set(s.waiver_id, s.waiver_version);
      }
      const needsAction = (waivers ?? []).filter((w: any) => {
        const v = latest.get(w.id);
        return v === undefined || v < w.version;
      });
      return needsAction.length;
    },
  });

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  const setupBanner = !ownerLoading && !owner;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
          {greeting}{profile?.first_name ? `, ${profile.first_name}` : ""}
        </h1>
        {org?.name && <p className="mt-2 text-base text-muted-foreground">{org.name}</p>}
      </div>

      <EnableNotificationsCard />

      {setupBanner && (
        <div className="rounded-xl border border-warning/30 bg-warning-light p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
            <div>
              <p className="font-semibold text-foreground">Your account is being set up</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Please contact {org?.name ?? "your pet care provider"} to complete your profile.
              </p>
            </div>
          </div>
        </div>
      )}

      {!!waiverAlert && waiverAlert > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary-light p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-primary-hover" />
              <div>
                <p className="font-semibold text-foreground">Action required</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  You have {waiverAlert} waiver{waiverAlert === 1 ? "" : "s"} to sign.
                </p>
              </div>
            </div>
            <Link
              to="/portal/waivers"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Sign now
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Upcoming bookings"
          icon={CalendarDays}
          viewAllTo="/portal/bookings"
          action={
            <Button size="sm" onClick={() => setWizardOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Book Now
            </Button>
          }
        >
          {upcoming && upcoming.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {upcoming.map((r: any) => (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {r.services?.name ?? "Service"}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {formatDate(r.start_at, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        {r.reservation_pets?.length > 0 &&
                          ` · ${r.reservation_pets.map((rp: any) => rp.pets?.name).filter(Boolean).join(", ")}`}
                      </p>
                    </div>
                    <ReservationStatusBadge status={r.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-6 text-center">
              <p className="text-sm text-muted-foreground">No upcoming bookings</p>
              <Button onClick={() => setWizardOpen(true)} variant="outline" size="sm" className="mt-3">
                <Plus className="mr-1 h-4 w-4" /> Book your next visit
              </Button>
            </div>
          )}
        </Card>

        <Card title="My pets" icon={PawPrint} viewAllTo="/portal/pets">
          {pets && pets.length > 0 ? (
            <>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {pets.length} pet{pets.length === 1 ? "" : "s"}
              </p>
              <ul className="space-y-3">
                {pets.slice(0, 4).map((p: any) => {
                  const status = getVaccinationStatus(p.vaccinations);
                  return (
                    <li key={p.id} className="flex items-center gap-3">
                      {p.photo_url ? (
                        <img
                          src={p.photo_url}
                          alt={p.name}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-lg">
                          {speciesIcon(p.species)}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-foreground truncate">{p.name}</p>
                          <VaccinationStatusBadge status={status} />
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{p.breed ?? "—"}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <Empty text="No pets yet" />
          )}
        </Card>

        <Card title="Outstanding invoices" icon={Receipt} viewAllTo="/portal/invoices">
          {invoices && invoices.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {invoices.map((inv: any) => (
                <li key={inv.id}>
                  <Link
                    to={`/portal/invoices/${inv.id}`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-3 transition hover:bg-card-alt"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {inv.invoice_number ?? "Invoice"}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {formatCents(inv.total_cents, inv.currency)} · Due {formatDate(inv.due_at)}
                      </p>
                    </div>
                    <InvoiceStatusBadge status={inv.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="You're all caught up!" />
          )}
        </Card>
      </div>

      <Card title="Recent report cards" icon={FileHeart} viewAllTo="/portal/report-cards">
        {reportCards && reportCards.length > 0 ? (
          <ul className="space-y-3">
            {reportCards.slice(0, 3).map((c: any) => {
              const r = ratingMeta(c.overall_rating);
              return (
                <li key={c.id}>
                  <Link
                    to={`/portal/report-cards/${c.id}`}
                    className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition hover:bg-card-alt"
                  >
                    {c.pets?.photo_url ? (
                      <img src={c.pets.photo_url} alt={c.pets.name} className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-lg">
                        {speciesIcon(c.pets?.species)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{c.pets?.name}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {formatDate(c.reservations?.start_at, { month: "short", day: "numeric" })}
                      </p>
                    </div>
                    {r && (
                      <span className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-semibold ${r.tone}`}>
                        {r.emoji} {r.label}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty text="No report cards yet" />
        )}
      </Card>

      <Card title="Messages" icon={MessageSquare} viewAllTo="/portal/messages">
        {conversation && conversation.last_message_at ? (
          <Link
            to="/portal/messages"
            className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-3 transition hover:bg-card-alt"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground truncate">
                {truncatePreview(conversation.last_message_preview ?? "", 60)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatRelativeTime(conversation.last_message_at)}
              </p>
            </div>
            {conversation.unread_owner > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">
                {conversation.unread_owner}
              </span>
            )}
          </Link>
        ) : (
          <Empty text="No messages yet" />
        )}
      </Card>

      <BookingWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  viewAllTo,
  action,
  children,
}: {
  title: string;
  icon: any;
  viewAllTo: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {action}
          <Link
            to={viewAllTo}
            className="inline-flex items-center text-sm font-medium text-primary-hover hover:underline"
          >
            View all <ChevronRight className="ml-0.5 h-4 w-4" />
          </Link>
        </div>
      </div>
      {children}
    </section>
  );
}

function Empty({ text, cta }: { text: string; cta?: { label: string; to: string } }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {cta && (
        <Link
          to={cta.to}
          className="mt-3 inline-flex items-center text-sm font-medium text-primary-hover hover:underline"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
