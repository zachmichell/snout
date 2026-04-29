import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, MessageSquareWarning, FileHeart, MapPin } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  validateVaccinations,
  validateWaivers,
  vaxOverallStatus,
  waiverOverallStatus,
  formatRelativeShort,
} from "@/lib/checkin";
import { VaxBadge, WaiverBadge } from "@/components/portal/check-in-out/WaiverVaxBadges";
import CheckInFlow, { CheckInPet } from "@/components/portal/check-in-out/CheckInFlow";
import CheckOutFlow from "@/components/portal/check-in-out/CheckOutFlow";
import { useMarkNoShow } from "@/hooks/useCheckInOut";
import StatusBadge from "@/components/portal/StatusBadge";
import { speciesIcon } from "@/lib/format";
import { useLocationFilter } from "@/contexts/LocationContext";

const TZ = "America/Edmonton";

function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

type ResRow = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  primary_owner_id: string | null;
  location_id: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  organization_id: string;
  services: { name: string; module: string } | null;
  owners: { id: string; first_name: string; last_name: string } | null;
  reservation_pets: {
    pets: {
      id: string;
      name: string;
      species: string;
      photo_url: string | null;
      vaccinations: { vaccine_type: string; expires_on: string | null }[];
    } | null;
  }[];
  playgroup_assignments: { id: string; playgroups: { name: string; color: string } | null; removed_at: string | null }[];
  kennel_run_assignments: { id: string; kennel_runs: { name: string } | null; removed_at: string | null }[];
  report_cards: { id: string; published: boolean }[];
  invoices: { id: string; invoice_number: string | null; status: string }[];
};

export default function CheckInOut() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const locationId = useLocationFilter();
  const [date, setDate] = useState<Date>(() => startOfDay(new Date()));
  const [openFlow, setOpenFlow] = useState<{ kind: "in" | "out"; reservationId: string } | null>(null);

  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["checkin-board", ymd(date), orgId, locationId],
    enabled: !!orgId,
    queryFn: async () => {
      const startISO = dayStart.toISOString();
      const endISO = dayEnd.toISOString();
      let q = supabase
        .from("reservations")
        .select(
          `id, start_at, end_at, status, primary_owner_id, location_id, checked_in_at, checked_out_at, organization_id,
           services:service_id(name, module),
           owners:primary_owner_id(id, first_name, last_name),
           reservation_pets(pets(id, name, species, photo_url, vaccinations(vaccine_type, expires_on, deleted_at))),
           playgroup_assignments(id, removed_at, playgroups(name, color)),
           kennel_run_assignments(id, removed_at, kennel_runs(name)),
           report_cards(id, published),
           invoices(id, invoice_number, status)`,
        )
        .is("deleted_at", null)
        .or(
          `and(start_at.gte.${startISO},start_at.lte.${endISO}),status.eq.checked_in,and(status.eq.checked_out,checked_out_at.gte.${startISO},checked_out_at.lte.${endISO})`,
        )
        .order("start_at", { ascending: true });
      if (locationId) q = q.eq("location_id", locationId);
      const { data, error } = await q;
      if (error) throw error;
      // Strip soft-deleted vaccinations
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        reservation_pets: (r.reservation_pets ?? []).map((rp: any) => ({
          ...rp,
          pets: rp.pets
            ? {
                ...rp.pets,
                vaccinations: (rp.pets.vaccinations ?? []).filter((v: any) => !v.deleted_at),
              }
            : null,
        })),
      })) as ResRow[];
    },
  });

  // Realtime: invalidate on reservation changes for this org
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`checkin-board-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservations", filter: `organization_id=eq.${orgId}` },
        () => qc.invalidateQueries({ queryKey: ["checkin-board"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [orgId, qc]);

  const { arrivals, here, departed } = useMemo(() => {
    const arrivals = rows
      .filter(
        (r) =>
          r.status === "confirmed" &&
          new Date(r.start_at) >= dayStart &&
          new Date(r.start_at) <= dayEnd,
      )
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    const here = rows
      .filter((r) => r.status === "checked_in")
      .sort(
        (a, b) =>
          new Date(a.checked_in_at ?? a.start_at).getTime() -
          new Date(b.checked_in_at ?? b.start_at).getTime(),
      );
    const departed = rows
      .filter(
        (r) =>
          r.status === "checked_out" &&
          r.checked_out_at &&
          new Date(r.checked_out_at) >= dayStart &&
          new Date(r.checked_out_at) <= dayEnd,
      )
      .sort((a, b) => new Date(b.checked_out_at!).getTime() - new Date(a.checked_out_at!).getTime());
    return { arrivals, here, departed };
  }, [rows, dayStart, dayEnd]);

  const goPrev = () => {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    setDate(startOfDay(d));
  };
  const goNext = () => {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    setDate(startOfDay(d));
  };
  const goToday = () => setDate(startOfDay(new Date()));

  const longDate = date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: TZ,
  });

  const flowReservation = openFlow ? rows.find((r) => r.id === openFlow.reservationId) : null;

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={goPrev} aria-label="Previous day">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={goNext} aria-label="Next day">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToday}>
                Today
              </Button>
              <Input
                type="date"
                value={ymd(date)}
                onChange={(e) => {
                  if (e.target.value) {
                    const [y, m, d] = e.target.value.split("-").map(Number);
                    setDate(startOfDay(new Date(y, m - 1, d)));
                  }
                }}
                className="w-[170px] bg-background"
              />
            </div>
            <h1 className="mt-3 font-display text-2xl text-foreground">Check-in / Check-out</h1>
            <p className="text-sm text-text-secondary">{longDate}</p>
          </div>
        </div>

        {/* Summary bar */}
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-card text-sm">
          <span>
            <span className="font-bold text-foreground">{arrivals.length}</span>{" "}
            <span className="text-text-secondary">Arriving</span>
          </span>
          <span className="text-text-tertiary">|</span>
          <span>
            <span className="font-bold text-foreground">{here.length}</span>{" "}
            <span className="text-text-secondary">Here</span>
          </span>
          <span className="text-text-tertiary">|</span>
          <span>
            <span className="font-bold text-foreground">{departed.length}</span>{" "}
            <span className="text-text-secondary">Departed</span>
          </span>
        </div>

        {isLoading ? (
          <div className="rounded-lg border border-border bg-card p-12 text-center text-sm text-text-secondary">
            Loading…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Column title="Arrivals" tone="arrivals" count={arrivals.length}>
              {arrivals.length === 0 ? (
                <Empty text="No arrivals scheduled" />
              ) : (
                arrivals.map((r) => (
                  <ArrivalCard
                    key={r.id}
                    res={r}
                    onCheckIn={() => setOpenFlow({ kind: "in", reservationId: r.id })}
                  />
                ))
              )}
            </Column>

            <Column title="Currently Here" tone="here" count={here.length}>
              {here.length === 0 ? (
                <Empty text="No pets currently checked in" />
              ) : (
                here.map((r) => (
                  <CurrentCard
                    key={r.id}
                    res={r}
                    onCheckOut={() => setOpenFlow({ kind: "out", reservationId: r.id })}
                  />
                ))
              )}
            </Column>

            <Column title="Departures" tone="departures" count={departed.length}>
              {departed.length === 0 ? (
                <Empty text="No departures yet" />
              ) : (
                departed.map((r) => <DepartureCard key={r.id} res={r} />)
              )}
            </Column>
          </div>
        )}
      </div>

      {/* Flow dialog */}
      <Dialog
        open={!!openFlow}
        onOpenChange={(o) => {
          if (!o) setOpenFlow(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">
              {openFlow?.kind === "in" ? "Check in" : "Check out"}
            </DialogTitle>
            <DialogDescription>
              {flowReservation?.reservation_pets
                ?.map((rp) => rp.pets?.name)
                .filter(Boolean)
                .join(", ")}
            </DialogDescription>
          </DialogHeader>
          {flowReservation && openFlow?.kind === "in" && (
            <CheckInFlow
              reservationId={flowReservation.id}
              ownerId={flowReservation.primary_owner_id}
              locationId={flowReservation.location_id}
              serviceModule={flowReservation.services?.module ?? null}
              pets={
                flowReservation.reservation_pets
                  .map((rp) => rp.pets)
                  .filter(Boolean)
                  .map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    species: p.species,
                    vaccinations: p.vaccinations ?? [],
                  })) as CheckInPet[]
              }
              onDone={() => setOpenFlow(null)}
              onCancel={() => setOpenFlow(null)}
            />
          )}
          {flowReservation && openFlow?.kind === "out" && (
            <CheckOutFlow
              reservationId={flowReservation.id}
              petName={flowReservation.reservation_pets[0]?.pets?.name}
              checkedInAt={flowReservation.checked_in_at}
              onDone={() => setOpenFlow(null)}
              onCancel={() => setOpenFlow(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}

const COLUMN_TONES: Record<string, string> = {
  arrivals: "bg-brand-cotton-bg",
  here: "bg-brand-mist-bg",
  departures: "bg-brand-frost-bg",
};

function Column({
  title,
  tone,
  count,
  children,
}: {
  title: string;
  tone: keyof typeof COLUMN_TONES;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-card">
      <header
        className={`flex items-center justify-between rounded-t-lg border-b border-border-subtle px-5 py-3 ${COLUMN_TONES[tone]}`}
      >
        <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
        <span className="rounded-pill bg-card px-2 py-0.5 text-xs font-semibold text-text-secondary">
          {count}
        </span>
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card-alt/40 px-4 py-8 text-center text-xs text-text-tertiary">
      {text}
    </div>
  );
}

function PetBlock({ res }: { res: ResRow }) {
  const pets = (res.reservation_pets ?? []).map((rp) => rp.pets).filter(Boolean) as NonNullable<
    ResRow["reservation_pets"][number]["pets"]
  >[];
  const primary = pets[0];
  const owner = res.owners;
  return (
    <div className="flex items-start gap-3">
      {primary?.photo_url ? (
        <img
          src={primary.photo_url}
          alt={primary.name}
          className="h-11 w-11 rounded-full object-cover"
        />
      ) : (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-lg">
          {speciesIcon(primary?.species)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-display text-base font-semibold text-foreground">
          {pets.map((p) => p.name).join(", ")}
        </div>
        <div className="mt-0.5 text-xs text-text-secondary">
          {owner ? `${owner.first_name} ${owner.last_name}` : "—"}
          {res.services?.name && <> · {res.services.name}</>}
        </div>
      </div>
    </div>
  );
}

function ArrivalCard({ res, onCheckIn }: { res: ResRow; onCheckIn: () => void }) {
  const noShow = useMarkNoShow();
  const pets = (res.reservation_pets ?? []).map((rp) => rp.pets).filter(Boolean);
  const allVax = pets.flatMap((p) => validateVaccinations(p?.species, p?.vaccinations ?? []));
  const worstVax = vaxOverallStatus(allVax);

  // Waiver fetched per arrival (cheap because card is rare)
  const { data: waiverStatus } = useQuery({
    queryKey: ["arrival-waiver", res.organization_id, res.primary_owner_id],
    enabled: !!res.primary_owner_id,
    queryFn: async () => {
      const [{ data: waivers }, { data: sigs }] = await Promise.all([
        supabase
          .from("waivers")
          .select("id, title, version")
          .eq("organization_id", res.organization_id)
          .eq("active", true)
          .is("deleted_at", null),
        supabase
          .from("waiver_signatures")
          .select("waiver_id, waiver_version")
          .eq("owner_id", res.primary_owner_id!),
      ]);
      return waiverOverallStatus(validateWaivers(waivers ?? [], sigs ?? []));
    },
  });

  return (
    <article className="space-y-3 rounded-lg border border-border-subtle bg-card-alt p-4">
      <PetBlock res={res} />
      <div className="text-xs text-text-tertiary">Scheduled {fmtTime(res.start_at)}</div>
      <div className="flex flex-wrap gap-1.5">
        <WaiverBadge status={waiverStatus ?? "signed"} />
        <VaxBadge status={worstVax} />
      </div>
      <div className="flex items-center justify-between">
        <button
          onClick={() =>
            window.confirm("Mark as no-show?") &&
            noShow.mutate({ reservationId: res.id, petName: pets[0]?.name })
          }
          className="text-xs font-semibold text-text-secondary hover:text-destructive"
        >
          Mark no-show
        </button>
        <Button size="sm" onClick={onCheckIn}>
          Check In
        </Button>
      </div>
    </article>
  );
}

function CurrentCard({ res, onCheckOut }: { res: ResRow; onCheckOut: () => void }) {
  const activePg = (res.playgroup_assignments ?? []).find((a) => !a.removed_at)?.playgroups;
  const activeKr = (res.kennel_run_assignments ?? []).find((a) => !a.removed_at)?.kennel_runs;
  const assigned = activePg?.name ?? activeKr?.name;

  return (
    <article className="space-y-3 rounded-lg border border-border-subtle bg-card-alt p-4">
      <PetBlock res={res} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
        <span>In {formatRelativeShort(res.checked_in_at)}</span>
        {assigned ? (
          <StatusBadge tone="primary" dot={false}>
            <MapPin className="h-3 w-3" /> {assigned}
          </StatusBadge>
        ) : (
          <StatusBadge tone="warning" dot={false}>Unassigned</StatusBadge>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Link to={`/care-logs?reservation=${res.id}`} className="text-primary hover:underline">
          Care Log
        </Link>
        <span className="text-text-tertiary">·</span>
        <Link to={`/reservations/${res.id}`} className="text-primary hover:underline">
          Report Card
        </Link>
        <span className="text-text-tertiary">·</span>
        <Link to={`/reservations/${res.id}`} className="text-primary hover:underline">
          Assign
        </Link>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onCheckOut}>
          Check Out
        </Button>
      </div>
    </article>
  );
}

function DepartureCard({ res }: { res: ResRow }) {
  const card = (res.report_cards ?? [])[0];
  const inv = (res.invoices ?? [])[0];
  return (
    <article className="space-y-2 rounded-lg border border-border-subtle bg-card-alt p-4">
      <PetBlock res={res} />
      <div className="text-xs text-text-tertiary">
        Out {fmtTime(res.checked_out_at)} ({formatRelativeShort(res.checked_out_at)})
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {card ? (
          card.published ? (
            <StatusBadge tone="success" dot={false}>
              <FileHeart className="h-3 w-3" /> Published
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning" dot={false}>
              <FileHeart className="h-3 w-3" /> Draft
            </StatusBadge>
          )
        ) : (
          <StatusBadge tone="muted" dot={false}>No report card</StatusBadge>
        )}
        {inv ? (
          <Link to={`/invoices/${inv.id}`} className="text-primary hover:underline">
            {inv.invoice_number ?? "Invoice"} ({inv.status})
          </Link>
        ) : (
          <span className="text-text-tertiary">No invoice</span>
        )}
      </div>
    </article>
  );
}
