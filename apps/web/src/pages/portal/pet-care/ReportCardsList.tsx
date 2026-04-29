import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarIcon, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { format, addDays, isSameDay } from "date-fns";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { speciesIcon } from "@/lib/format";
import ReportCardEditor from "@/components/portal/pet-care/ReportCardEditor";
import { cn } from "@/lib/utils";

export default function ReportCardsList() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const [date, setDate] = useState<Date>(new Date());
  const [editor, setEditor] = useState<{ reservationId: string; petId: string; petName: string } | null>(null);

  // Pets on site for the selected date (checked-in or active boarding spanning that date).
  const { data: visits } = useQuery({
    queryKey: ["report-cards-visits", orgId, format(date, "yyyy-MM-dd")],
    enabled: !!orgId,
    queryFn: async () => {
      const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
      const { data, error } = await supabase
        .from("reservations")
        .select(
          "id, start_at, end_at, status, services(name), owners:primary_owner_id(first_name, last_name), reservation_pets(pet_id, pets(id, name, species, photo_url))",
        )
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .lte("start_at", dayEnd.toISOString())
        .gte("end_at", dayStart.toISOString())
        .in("status", ["checked_in", "checked_out", "confirmed"]);
      if (error) throw error;
      return data ?? [];
    },
  });

  const reservationIds = useMemo(() => (visits ?? []).map((v: any) => v.id), [visits]);

  const { data: cards } = useQuery({
    queryKey: ["report-cards-by-resv", reservationIds],
    enabled: reservationIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_cards")
        .select("id, reservation_id, pet_id, published, published_at")
        .in("reservation_id", reservationIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const cardByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of cards ?? []) m.set(`${c.reservation_id}:${c.pet_id}`, c);
    return m;
  }, [cards]);

  const rows = useMemo(() => {
    const out: { reservationId: string; pet: any; ownerName: string; serviceName: string }[] = [];
    for (const r of visits ?? []) {
      const ownerName = r.owners ? `${(r.owners as any).first_name} ${(r.owners as any).last_name}` : "—";
      for (const rp of (r as any).reservation_pets ?? []) {
        if (!rp.pets) continue;
        out.push({
          reservationId: r.id,
          pet: rp.pets,
          ownerName,
          serviceName: (r.services as any)?.name ?? "—",
        });
      }
    }
    return out;
  }, [visits]);

  const stepDay = (delta: number) => setDate((d) => addDays(d, delta));
  const isToday = isSameDay(date, new Date());

  return (
    <PortalLayout>
      <div className="px-8 py-6 space-y-6">
        <PageHeader title="Report Cards" description="Create and publish report cards for pets on site." />

        {/* Date nav */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => stepDay(-1)} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant={isToday ? "default" : "outline"} size="sm" onClick={() => setDate(new Date())}>
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => stepDay(1)} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[260px] justify-start text-left font-normal">
                <CalendarIcon className="h-4 w-4" />
                {format(date, "EEEE, MMMM d, yyyy")}
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
        </div>

        {/* List */}
        <section className="rounded-lg border border-border bg-surface shadow-card">
          <div className="border-b border-border-subtle px-5 py-3 flex items-center justify-between">
            <div className="font-display text-base">Pets on site ({rows.length})</div>
          </div>
          {rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-text-secondary">
              No pets on site for this date.
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {rows.map((row) => {
                const card = cardByKey.get(`${row.reservationId}:${row.pet.id}`);
                const status = card?.published
                  ? { label: "Published", tone: "bg-success-light text-success" }
                  : card
                    ? { label: "Draft", tone: "bg-warning-light text-warning" }
                    : null;
                return (
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
                        {row.ownerName} · {row.serviceName}
                      </div>
                    </div>
                    {status && (
                      <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${status.tone}`}>
                        {status.label}
                      </span>
                    )}
                    <Button
                      variant={card ? "outline" : "default"}
                      size="sm"
                      onClick={() =>
                        setEditor({ reservationId: row.reservationId, petId: row.pet.id, petName: row.pet.name })
                      }
                    >
                      <FileText className="h-4 w-4" />
                      {card ? "View / Edit" : "Create"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {editor && (
        <ReportCardEditor
          open={!!editor}
          onOpenChange={(v) => { if (!v) setEditor(null); }}
          reservationId={editor.reservationId}
          petId={editor.petId}
          petName={editor.petName}
        />
      )}
    </PortalLayout>
  );
}
