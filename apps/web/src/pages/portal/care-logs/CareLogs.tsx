import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrgCareLogs } from "@/hooks/useCareLogs";
import {
  LOG_TYPE_CHIP, LOG_TYPE_DOT, LOG_TYPE_EMOJI, LOG_TYPE_LABELS, LogType, formatTime,
} from "@/lib/care";
import { speciesIcon } from "@/lib/format";
import QuickLogSheet from "@/components/portal/pet-care/QuickLogSheet";
import ReportCardEditor from "@/components/portal/pet-care/ReportCardEditor";
import { cn } from "@/lib/utils";

const QUICK_TYPES: LogType[] = ["feeding", "medication", "potty", "play", "rest", "note"];

export default function CareLogs() {
  const { membership } = useAuth();
  const [date, setDate] = useState<Date>(new Date());
  const [petQuery, setPetQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | LogType>("all");

  const [logSheet, setLogSheet] = useState<{ open: boolean; petId: string; petName: string; reservationId: string | null; type: LogType }>(
    { open: false, petId: "", petName: "", reservationId: null, type: "note" },
  );
  const [editorOpen, setEditorOpen] = useState<{ open: boolean; reservationId: string; petId: string; petName: string } | null>(null);

  const dateISO = format(date, "yyyy-MM-dd");

  const { data: activeVisits } = useQuery({
    queryKey: ["active-visits", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select(
          "id, start_at, checked_in_at, services(name), owners:primary_owner_id(first_name, last_name), reservation_pets(id, pet_id, pets(id, name, species, photo_url))",
        )
        .eq("organization_id", membership!.organization_id)
        .eq("status", "checked_in")
        .is("deleted_at", null)
        .order("checked_in_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: logs } = useOrgCareLogs(membership?.organization_id, dateISO);

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    return logs.filter((l: any) => {
      if (typeFilter !== "all" && l.log_type !== typeFilter) return false;
      if (petQuery.trim()) {
        const q = petQuery.toLowerCase();
        const name = (l.pets?.name ?? "").toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    });
  }, [logs, typeFilter, petQuery]);

  // Group filtered logs by pet for the timeline
  const groupedByPet = useMemo(() => {
    const map = new Map<string, { pet: any; logs: any[] }>();
    for (const l of filteredLogs) {
      if (!l.pets) continue;
      const key = l.pets.id;
      if (!map.has(key)) map.set(key, { pet: l.pets, logs: [] });
      map.get(key)!.logs.push(l);
    }
    return Array.from(map.values());
  }, [filteredLogs]);

  // For each active visit, group pets (one entry per pet on the reservation)
  const activePets = useMemo(() => {
    const out: { reservationId: string; pet: any; ownerName: string; serviceName: string; checkedInAt: string }[] = [];
    for (const r of activeVisits ?? []) {
      const ownerName = r.owners ? `${(r.owners as any).first_name} ${(r.owners as any).last_name}` : "—";
      for (const rp of (r as any).reservation_pets ?? []) {
        if (!rp.pets) continue;
        out.push({
          reservationId: r.id,
          pet: rp.pets,
          ownerName,
          serviceName: (r.services as any)?.name ?? "—",
          checkedInAt: r.checked_in_at ?? r.start_at,
        });
      }
    }
    return out;
  }, [activeVisits]);

  return (
    <PortalLayout>
      <div className="px-8 py-6 space-y-6">
        <PageHeader
          title="Care Logs"
          description={format(date, "EEEE, MMMM d, yyyy")}
        />

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[220px] justify-start text-left font-normal">
                <CalendarIcon className="h-4 w-4" />
                {format(date, "PPP")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(d)}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Input
            placeholder="Filter by pet name…"
            value={petQuery}
            onChange={(e) => setPetQuery(e.target.value)}
            className="w-[240px]"
          />
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {QUICK_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{LOG_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Active visits */}
        <section className="rounded-lg border border-border bg-surface shadow-card">
          <div className="border-b border-border-subtle px-5 py-3">
            <div className="font-display text-base">Active visits ({activePets.length})</div>
          </div>
          {activePets.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-text-secondary">
              No pets currently checked in.
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {activePets.map((row) => (
                <li key={`${row.reservationId}-${row.pet.id}`} className="flex flex-wrap items-center gap-4 p-4">
                  {row.pet.photo_url ? (
                    <img src={row.pet.photo_url} alt={row.pet.name} className="h-12 w-12 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background text-xl">
                      {speciesIcon(row.pet.species)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <Link to={`/pets/${row.pet.id}`} className="font-medium text-foreground hover:text-primary">
                      {row.pet.name}
                    </Link>
                    <div className="text-xs text-text-secondary">
                      {row.ownerName} · {row.serviceName} · in {formatTime(row.checkedInAt)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_TYPES.map((t) => (
                      <button
                        key={t}
                        onClick={() => setLogSheet({ open: true, petId: row.pet.id, petName: row.pet.name, reservationId: row.reservationId, type: t })}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition hover:opacity-90 ${LOG_TYPE_CHIP[t]}`}
                      >
                        {LOG_TYPE_EMOJI[t]} {LOG_TYPE_LABELS[t]}
                      </button>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditorOpen({ open: true, reservationId: row.reservationId, petId: row.pet.id, petName: row.pet.name })}
                    >
                      Report Card
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Timeline */}
        <section className="rounded-lg border border-border bg-surface shadow-card">
          <div className="border-b border-border-subtle px-5 py-3">
            <div className="font-display text-base">
              Timeline · {filteredLogs.length} entr{filteredLogs.length === 1 ? "y" : "ies"}
            </div>
          </div>
          {groupedByPet.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-text-secondary">No care logs match this filter.</p>
              <p className="mt-1 text-xs text-text-tertiary">Try changing the date or pet filter, or log activity from a checked-in pet above.</p>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {groupedByPet.map(({ pet, logs }) => (
                <div key={pet.id} className="p-5">
                  <div className="mb-3 flex items-center gap-3">
                    {pet.photo_url ? (
                      <img src={pet.photo_url} alt={pet.name} className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background text-base">
                        {speciesIcon(pet.species)}
                      </span>
                    )}
                    <Link to={`/pets/${pet.id}`} className="font-display text-base hover:text-primary">{pet.name}</Link>
                  </div>
                  <ol className="relative space-y-3 border-l border-border-subtle pl-5">
                    {logs.map((l: any) => (
                      <li key={l.id} className="relative">
                        <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-2 ring-surface ${LOG_TYPE_DOT[l.log_type as LogType]}`} />
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-sm font-medium text-foreground">{LOG_TYPE_LABELS[l.log_type as LogType]}</span>
                          <span className="text-xs text-text-tertiary">{formatTime(l.logged_at)}</span>
                          {l.profiles && (
                            <span className="text-xs text-text-tertiary">
                              · {(l.profiles as any).first_name ?? ""} {(l.profiles as any).last_name ?? ""}
                            </span>
                          )}
                        </div>
                        {l.notes && <p className="mt-0.5 text-sm text-text-secondary whitespace-pre-wrap">{l.notes}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <QuickLogSheet
        open={logSheet.open}
        onOpenChange={(v) => setLogSheet((s) => ({ ...s, open: v }))}
        petId={logSheet.petId}
        petName={logSheet.petName}
        reservationId={logSheet.reservationId}
        initialType={logSheet.type}
      />

      {editorOpen && (
        <ReportCardEditor
          open={editorOpen.open}
          onOpenChange={(v) => setEditorOpen(v ? editorOpen : null)}
          reservationId={editorOpen.reservationId}
          petId={editorOpen.petId}
          petName={editorOpen.petName}
        />
      )}
    </PortalLayout>
  );
}
