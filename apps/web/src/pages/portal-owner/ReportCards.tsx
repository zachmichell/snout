import { Link } from "react-router-dom";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { useOwnerReportCards } from "@/hooks/useReportCards";
import { ratingMeta, moodMeta } from "@/lib/care";
import { formatDate, speciesIcon } from "@/lib/format";

export default function OwnerReportCards() {
  const { data: owner, isLoading: ownerLoading } = useOwnerRecord();
  const { data: cards, isLoading } = useOwnerReportCards(owner?.id);

  if (ownerLoading || isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!owner) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Your account is being set up — report cards will appear once your provider links your profile.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">Report Cards</h1>
        <p className="mt-2 text-base text-muted-foreground">See how your pet's visits went.</p>
      </div>

      {!cards || cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
          No report cards yet. They'll appear here after your pet's next visit.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((c: any) => {
            const r = ratingMeta(c.overall_rating);
            const m = moodMeta(c.mood);
            return (
              <Link
                key={c.id}
                to={`/portal/report-cards/${c.id}`}
                className="group rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  {c.pets?.photo_url ? (
                    <img src={c.pets.photo_url} alt={c.pets.name} className="h-12 w-12 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-xl">
                      {speciesIcon(c.pets?.species)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg font-semibold text-foreground group-hover:text-primary-hover">
                      {c.pets?.name}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {c.reservations?.services?.name ?? "Visit"} ·{" "}
                      {formatDate(c.reservations?.start_at, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {r && (
                    <span className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-semibold ${r.tone}`}>
                      {r.emoji} {r.label}
                    </span>
                  )}
                  {m && (
                    <span className="inline-flex items-center gap-1 rounded-pill border border-border bg-background px-2.5 py-1 text-xs">
                      {m.emoji} {m.label}
                    </span>
                  )}
                </div>
                {c.summary && (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{c.summary}</p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
