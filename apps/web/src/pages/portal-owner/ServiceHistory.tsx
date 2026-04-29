import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { History, ChevronRight, Filter } from "lucide-react";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { useOwnerServiceHistory, type OwnerHistoryEntry } from "@/hooks/useOwnerServiceHistory";
import { formatDate } from "@/lib/format";
import { formatDateTime } from "@/lib/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

function durationLabel(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = mins / 60;
  if (hours < 24) return `${hours.toFixed(hours % 1 ? 1 : 0)} hr`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function staffName(staff?: OwnerHistoryEntry["staff_profile"]) {
  if (!staff) return "—";
  const name = `${staff.first_name ?? ""} ${staff.last_name ?? ""}`.trim();
  return name || "—";
}

const statusBadge: Record<string, string> = {
  checked_out: "bg-success-light text-success border-success/30",
  checked_in: "bg-primary-light text-primary-hover border-primary/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  no_show: "bg-warning-light text-warning border-warning/30",
};

const statusLabel: Record<string, string> = {
  checked_out: "Completed",
  checked_in: "In Progress",
  cancelled: "Cancelled",
  no_show: "No Show",
};

export default function ServiceHistory() {
  const { data: owner } = useOwnerRecord();
  const { data: history = [], isLoading } = useOwnerServiceHistory(owner?.id);

  const [petFilter, setPetFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const petOptions = useMemo(() => {
    const map = new Map<string, string>();
    history.forEach((h) =>
      h.reservation_pets?.forEach((rp) => {
        if (rp.pets) map.set(rp.pets.id, rp.pets.name);
      }),
    );
    return Array.from(map.entries());
  }, [history]);

  const serviceOptions = useMemo(() => {
    const set = new Set<string>();
    history.forEach((h) => h.services?.module && set.add(h.services.module));
    return Array.from(set);
  }, [history]);

  const filtered = useMemo(() => {
    const fromTs = from ? new Date(from).getTime() : -Infinity;
    const toTs = to ? new Date(to).getTime() + 86_400_000 : Infinity;
    return history.filter((h) => {
      const t = new Date(h.start_at).getTime();
      if (t < fromTs || t > toTs) return false;
      if (serviceFilter !== "all" && h.services?.module !== serviceFilter) return false;
      if (petFilter !== "all") {
        const has = h.reservation_pets?.some((rp) => rp.pets?.id === petFilter);
        if (!has) return false;
      }
      return true;
    });
  }, [history, from, to, petFilter, serviceFilter]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
          Service History
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          A timeline of every visit your pets have had with us
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
          <Filter className="h-4 w-4" /> Filters
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Pet</label>
            <Select value={petFilter} onValueChange={setPetFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All pets</SelectItem>
                {petOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Service type</label>
            <Select value={serviceFilter} onValueChange={setServiceFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All services</SelectItem>
                {serviceOptions.map((m) => (
                  <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
          <History className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-base text-foreground">
            {history.length === 0 ? "No service history yet." : "No visits match these filters."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((h) => {
            const petNames = (h.reservation_pets ?? [])
              .map((rp) => rp.pets?.name)
              .filter(Boolean)
              .join(", ");
            const linkTo = h.report_card?.published
              ? `/portal/report-cards/${h.report_card.id}`
              : `/portal/bookings`;
            return (
              <li key={h.id}>
                <Link
                  to={linkTo}
                  className="group block rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-lg font-semibold text-foreground">
                          {h.services?.name ?? "Visit"}
                        </h3>
                        <Badge
                          variant="outline"
                          className={statusBadge[h.status] ?? "bg-muted text-muted-foreground"}
                        >
                          {statusLabel[h.status] ?? h.status}
                        </Badge>
                        {h.report_card?.published && (
                          <Badge variant="outline" className="bg-primary-light text-primary-hover border-primary/30">
                            Report card
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatDateTime(h.start_at)} · {durationLabel(h.start_at, h.end_at)}
                      </p>
                      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Pet</dt>
                          <dd className="mt-0.5 font-medium text-foreground">{petNames || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Staff</dt>
                          <dd className="mt-0.5 font-medium text-foreground">{staffName(h.staff_profile)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Location</dt>
                          <dd className="mt-0.5 font-medium text-foreground">{h.locations?.name ?? "—"}</dd>
                        </div>
                      </dl>
                      {h.notes && (
                        <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{h.notes}</p>
                      )}
                    </div>
                    <ChevronRight className="hidden h-5 w-5 shrink-0 text-muted-foreground transition group-hover:text-primary sm:block" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
