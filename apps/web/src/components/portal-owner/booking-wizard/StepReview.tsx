import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, MapPin, PawPrint, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatCentsShort } from "@/lib/money";
import { combineDateTime, diffNights, estimatePriceCents } from "@/lib/booking";
import type { WizardState } from "./BookingWizard";

export default function StepReview({
  state,
  setState,
  onBack,
  onComplete,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  onBack: () => void;
  onComplete: () => void;
}) {
  const { user, membership } = useAuth();
  const { data: owner } = useOwnerRecord();
  const [submitting, setSubmitting] = useState(false);

  const dt = state.datetime!;
  const svc = state.service!;
  const nights = dt.endDate ? diffNights(dt.date, dt.endDate) : 0;
  const hours = dt.hours ?? 1;

  const { startISO, endISO } = useMemo(() => {
    if (svc.duration_type === "overnight" || svc.duration_type === "multi_night") {
      const start = combineDateTime(dt.date, dt.startTime);
      const end = combineDateTime(dt.endDate!, dt.endTime ?? "11:00");
      return { startISO: start.toISOString(), endISO: end.toISOString() };
    }
    if (svc.duration_type === "hourly") {
      const start = combineDateTime(dt.date, dt.startTime);
      const end = new Date(start);
      end.setHours(end.getHours() + hours);
      return { startISO: start.toISOString(), endISO: end.toISOString() };
    }
    if (svc.duration_type === "flat") {
      // 7.1: end = start + service.estimated_minutes. Falls back to
      // 60 minutes if the operator hasn't set a duration; the wizard's
      // earlier validation prevents reaching this fallback in practice.
      const start = combineDateTime(dt.date, dt.startTime);
      const minutes = svc.estimated_minutes ?? 60;
      const end = new Date(start.getTime() + minutes * 60_000);
      return { startISO: start.toISOString(), endISO: end.toISOString() };
    }
    const start = combineDateTime(dt.date, dt.startTime);
    const end = combineDateTime(dt.date, dt.endTime ?? dt.startTime);
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }, [dt, svc.duration_type, svc.estimated_minutes, hours]);

  const estimate = estimatePriceCents({
    basePriceCents: svc.base_price_cents,
    durationType: svc.duration_type,
    petCount: state.pets.length,
    nights,
    hours,
  });

  const dateLabel = (() => {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    if (svc.duration_type === "overnight" || svc.duration_type === "multi_night") {
      return `${fmt(startISO)} → ${fmt(endISO)} (${nights} night${nights === 1 ? "" : "s"})`;
    }
    if (svc.duration_type === "flat") {
      // 7.1: appointment-style line reads "May 8, 10:00 AM (90 min)"
      // — no end time; the duration is the more useful detail.
      const minutes = svc.estimated_minutes ?? 60;
      return `${fmt(startISO)} (${minutes} min)`;
    }
    return `${fmt(startISO)} – ${new Date(endISO).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  })();

  const submit = useMutation({
    mutationFn: async () => {
      if (!owner || !membership) throw new Error("Missing account info");
      setSubmitting(true);

      // 7.3: Pre-flight conflict check. Catches the common case
      // of a customer picking a slot that's already taken before we
      // hit the DB exclusion constraint with a less-friendly error.
      // The RPC is privacy-preserving — only returns true/false.
      const { data: hasConflict, error: conflictErr } = await supabase.rpc(
        "check_booking_conflict",
        {
          _organization_id: membership.organization_id,
          _service_id: svc.id,
          _start_at: startISO,
          _end_at: endISO,
        },
      );
      if (conflictErr) throw conflictErr;
      if (hasConflict) {
        throw new Error(
          "That time slot is already taken. Please pick a different time and try again.",
        );
      }

      const { data: res, error: resErr } = await supabase
        .from("reservations")
        .insert({
          organization_id: membership.organization_id,
          location_id: state.locationId,
          service_id: svc.id,
          primary_owner_id: owner.id,
          start_at: startISO,
          end_at: endISO,
          status: "requested",
          source: "owner_self_serve",
          requested_at: new Date().toISOString(),
          notes: state.notes || null,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (resErr) throw resErr;

      const rows = state.pets.map((p) => ({
        organization_id: membership.organization_id,
        reservation_id: res.id,
        pet_id: p.id,
      }));
      const { error: rpErr } = await supabase.from("reservation_pets").insert(rows);
      if (rpErr) throw rpErr;

      // 7.1 follow-up: grooming services need a parallel
      // grooming_appointments row per pet so the staff Grooming page
      // surfaces the request. groomer_id is the customer's pick (or
      // null for "any available", in which case staff assigns on
      // confirmation). estimated_duration_minutes comes from the
      // service so the staff calendar shows the right block size.
      if (svc.module === "grooming") {
        const startDate = startISO.slice(0, 10); // yyyy-mm-dd
        const startTimeOfDay = new Date(startISO).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        });
        const apptRows = state.pets.map((p) => ({
          organization_id: membership.organization_id,
          reservation_id: res.id,
          pet_id: p.id,
          owner_id: owner.id,
          groomer_id: state.groomerId, // null = "any available"
          appointment_date: startDate,
          start_time: startTimeOfDay,
          estimated_duration_minutes: svc.estimated_minutes ?? 60,
          services_requested: [svc.name],
          price_cents: svc.base_price_cents,
          status: "requested",
          notes: state.notes || null,
        }));
        const { error: apptErr } = await supabase
          .from("grooming_appointments")
          .insert(apptRows);
        if (apptErr) throw apptErr;
      }
      return res.id;
    },
    onSuccess: () => {
      toast.success("Booking request submitted! We'll confirm your reservation shortly.");
      onComplete();
    },
    onError: (e: any) => {
      setSubmitting(false);
      toast.error(e.message ?? "Could not submit booking");
    },
  });

  return (
    <div className="space-y-4 py-2">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Service</p>
            <p className="font-medium text-foreground">{svc.name}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <CalendarDays className="mt-0.5 h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">When</p>
            <p className="font-medium text-foreground">{dateLabel}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <PawPrint className="mt-0.5 h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pets</p>
            <p className="font-medium text-foreground">{state.pets.map((p) => p.name).join(", ")}</p>
          </div>
        </div>
        {state.locationId && (
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-4 w-4 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Location</p>
              <p className="font-medium text-foreground">Selected location</p>
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-foreground" htmlFor="notes">
          Special instructions <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Textarea
          id="notes"
          value={state.notes}
          onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
          placeholder="Anything the staff should know?"
          className="mt-1.5"
          rows={3}
        />
      </div>

      <div className="rounded-xl border border-border bg-primary-light/40 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-foreground">Estimated total</span>
          <span className="font-display text-xl font-semibold text-foreground">
            {formatCentsShort(estimate)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Estimate — final price set by staff when they confirm your booking.
        </p>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button onClick={() => submit.mutate()} disabled={submitting}>
          {submitting ? "Submitting…" : "Request Booking"}
        </Button>
      </div>
    </div>
  );
}
