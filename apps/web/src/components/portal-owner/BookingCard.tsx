import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MapPin, PawPrint, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
import BookingStatusBadge from "./BookingStatusBadge";
import { formatDate } from "@/lib/format";
import type { OwnerBooking } from "@/hooks/useOwnerBookings";
import { diffNights } from "@/lib/booking";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dateRangeLabel(b: OwnerBooking): string {
  const start = new Date(b.start_at);
  const end = new Date(b.end_at);
  const dur = b.services?.duration_type;
  if (dur === "overnight" || dur === "multi_night") {
    const nights = diffNights(b.start_at.slice(0, 10), b.end_at.slice(0, 10));
    return `${formatDate(start, { month: "short", day: "numeric" })} – ${formatDate(end, { month: "short", day: "numeric" })} (${nights} night${nights === 1 ? "" : "s"})`;
  }
  return `${formatDate(start, { weekday: "short", month: "short", day: "numeric" })} · ${fmtTime(b.start_at)} – ${fmtTime(b.end_at)}`;
}

export default function BookingCard({
  booking,
  showLocation,
}: {
  booking: OwnerBooking;
  showLocation: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const qc = useQueryClient();

  const cancelable = booking.status === "requested" || booking.status === "confirmed";
  const pets = (booking.reservation_pets ?? [])
    .map((rp) => rp.pets?.name)
    .filter(Boolean)
    .join(", ");

  const cancelMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("reservations")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_reason: "Cancelled by owner",
        })
        .eq("id", booking.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Booking cancelled");
      qc.invalidateQueries({ queryKey: ["owner-bookings"] });
      qc.invalidateQueries({ queryKey: ["owner-upcoming"] });
      setConfirmOpen(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Could not cancel booking"),
  });

  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-foreground">
            {booking.services?.name ?? "Service"}
          </h3>
          <div className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
            <p className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              {dateRangeLabel(booking)}
            </p>
            {pets && (
              <p className="flex items-center gap-2">
                <PawPrint className="h-4 w-4" />
                {pets}
              </p>
            )}
            {showLocation && booking.locations?.name && (
              <p className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {booking.locations.name}
              </p>
            )}
          </div>
        </div>
        <BookingStatusBadge status={booking.status} />
      </div>

      {(booking as any).checked_in_at && booking.status === "checked_in" && (
        <p className="mt-3 rounded-lg bg-success-light p-3 text-sm text-success">
          ✓ Checked in at {fmtTime((booking as any).checked_in_at)}
        </p>
      )}
      {(booking as any).checked_out_at && booking.status === "checked_out" && (
        <p className="mt-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          ✓ Checked out at {fmtTime((booking as any).checked_out_at)}
        </p>
      )}

      {booking.notes && (
        <p className="mt-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Notes: </span>
          {booking.notes}
        </p>
      )}

      {cancelable && (
        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            className="border-danger/30 text-danger hover:bg-danger-light"
          >
            <X className="mr-1.5 h-4 w-4" /> Cancel booking
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel your {booking.services?.name ?? "booking"} on{" "}
              {formatDate(booking.start_at, { month: "short", day: "numeric" })}? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep booking</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                cancelMut.mutate();
              }}
              disabled={cancelMut.isPending}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
            >
              Yes, cancel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
