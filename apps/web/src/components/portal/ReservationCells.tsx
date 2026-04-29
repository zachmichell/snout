import { Link } from "react-router-dom";
import { formatTime } from "@/lib/money";

const TZ = "America/Edmonton";

export type CellPet = {
  id?: string;
  name: string | null;
  breed: string | null;
  photo_url: string | null;
};

export type CellOwner = {
  id?: string;
  first_name: string | null;
  last_name: string | null;
  daycare_full_day_credits: number | null;
  daycare_half_day_credits: number | null;
  boarding_night_credits: number | null;
};

/**
 * PetCell — avatar + name + breed.
 * Used in any list/table that shows reservations or services. Keeps the visual
 * pattern consistent across Pack View, the Reservations list, etc.
 */
export function PetCell({
  pets,
  linkTo,
}: {
  pets: Array<CellPet | null | undefined>;
  linkTo: string;
}) {
  const filtered = pets.filter(Boolean) as CellPet[];
  const first = filtered[0];
  const extra = Math.max(0, filtered.length - 1);
  return (
    <Link to={linkTo} className="group flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {first?.photo_url ? (
          <img src={first.photo_url} alt={first.name ?? ""} className="h-full w-full object-cover" />
        ) : (
          (first?.name?.[0] ?? "?").toUpperCase()
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground group-hover:text-primary">
          {first?.name ?? "—"}
          {extra > 0 && <span className="ml-1 text-text-tertiary">+{extra}</span>}
        </div>
        {first?.breed && (
          <div className="truncate text-xs text-text-secondary">{first.breed}</div>
        )}
      </div>
    </Link>
  );
}

/** OwnerCell — name + credit summary (e.g. "12 full · 4 half · 5 nights"). */
export function OwnerCell({ owner }: { owner: CellOwner | null | undefined }) {
  const name = owner ? [owner.first_name, owner.last_name].filter(Boolean).join(" ") || "—" : "—";
  const credits = ownerCreditSummary(owner ?? null);
  return (
    <div className="min-w-0">
      <div className="truncate text-text-secondary">{name}</div>
      {credits && <div className="truncate text-[11px] text-text-tertiary">{credits}</div>}
    </div>
  );
}

export function ownerCreditSummary(o: CellOwner | null): string | null {
  if (!o) return null;
  const full = o.daycare_full_day_credits ?? 0;
  const half = o.daycare_half_day_credits ?? 0;
  const nights = o.boarding_night_credits ?? 0;
  // Always render all three buckets — surfaces a "0" instead of hiding the type
  // so staff can see at a glance which credits are exhausted.
  return `${full} full · ${half} half · ${nights} ${nights === 1 ? "night" : "nights"}`;
}

/** "Apr 26 · 8:00 AM" — date + time, in the facility's timezone. */
export function formatDayTime(iso: string): string {
  const date = new Date(iso).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: TZ,
  });
  return `${date} · ${formatTime(iso, TZ)}`;
}

/** Effective start: actual check-in once checked in, else scheduled start. */
export function effectiveStart(r: { checked_in_at?: string | null; start_at: string }): string {
  return r.checked_in_at ?? r.start_at;
}

/** Effective end: actual check-out once checked out, else scheduled end. */
export function effectiveEnd(r: { checked_out_at?: string | null; end_at: string }): string {
  return r.checked_out_at ?? r.end_at;
}

/**
 * Module classification — mirrors the user-facing terminology distinction:
 *  - daycare / boarding → "reservation"
 *  - grooming / training → "service"
 *
 * Used to split a single Service column into two columns (Reservation, Service)
 * across the Pack View tables and the Reservations list.
 */
type ServiceRef = { name: string | null; module: string | null } | null | undefined;

export function reservationLabel(services: ServiceRef): string {
  if (!services) return "—";
  if (services.module === "daycare" || services.module === "boarding") {
    return services.name ?? "—";
  }
  return "—";
}

export function serviceLabel(services: ServiceRef): string {
  if (!services) return "—";
  if (services.module === "grooming" || services.module === "training") {
    return services.name ?? "—";
  }
  return "—";
}
