import { useNavigate } from "react-router-dom";
import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import ModuleBadge from "@/components/portal/ModuleBadge";
import { formatTime } from "@/lib/money";

export type ScheduleReservation = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  notes: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  services: { name: string; module: string } | null;
  owners: { last_name: string } | null;
  reservation_pets: { pets: { name: string; breed: string | null } | null }[];
};

const AVATAR_TONES = [
  "bg-brand-cotton-bg text-foreground",
  "bg-brand-vanilla-bg text-foreground",
  "bg-brand-frost-bg text-foreground",
  "bg-brand-mist-bg text-foreground",
];

function avatarTone(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export default function ReservationCard({
  reservation,
  timezone,
  action,
  meta,
  overdue,
}: {
  reservation: ScheduleReservation;
  timezone: string;
  action?: { label: string; variant?: "default" | "outline"; onClick: () => void; loading?: boolean };
  meta?: string;
  overdue?: boolean;
}) {
  const navigate = useNavigate();
  const pets = (reservation.reservation_pets ?? [])
    .map((rp) => rp.pets)
    .filter(Boolean) as { name: string; breed: string | null }[];
  const primary = pets[0];
  const petLabel = pets.length > 1 ? `${primary?.name} +${pets.length - 1}` : primary?.name ?? "Pet";
  const breed = primary?.breed ?? "";
  const initial = (primary?.name ?? "?")[0]?.toUpperCase();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/reservations/${reservation.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate(`/reservations/${reservation.id}`);
      }}
      className={`group flex min-h-[80px] cursor-pointer items-center gap-4 rounded-lg border ${
        overdue ? "border-warning" : "border-border"
      } bg-card px-4 py-3 shadow-card transition hover:bg-background`}
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-lg font-semibold ${avatarTone(
          primary?.name ?? "x",
        )}`}
      >
        {initial}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-display text-base font-semibold text-foreground">{petLabel}</span>
          {breed && <span className="truncate text-xs text-text-tertiary">· {breed}</span>}
          {reservation.services?.module && <ModuleBadge module={reservation.services.module} />}
          {reservation.notes && (
            <StickyNote className="h-3.5 w-3.5 text-text-tertiary" aria-label="Has notes" />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <span>{reservation.owners?.last_name ?? "—"}</span>
          <span className="text-text-tertiary">·</span>
          <span className="truncate">{reservation.services?.name ?? "—"}</span>
          <span className="text-text-tertiary">·</span>
          <span>{meta ?? `${formatTime(reservation.start_at, timezone)} → ${formatTime(reservation.end_at, timezone)}`}</span>
          {overdue && <span className="font-semibold text-warning">· Overdue</span>}
        </div>
      </div>

      {action && (
        <Button
          size="sm"
          variant={action.variant ?? "default"}
          disabled={action.loading}
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
        >
          {action.loading ? "…" : action.label}
        </Button>
      )}
    </div>
  );
}
