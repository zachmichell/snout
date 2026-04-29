import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { createInvoiceForReservation } from "@/lib/invoice";
import { pgErrorToMessage } from "@/lib/db-errors";

const INVALIDATE_KEYS = [
  "checkin-board",
  "schedule-day",
  "schedule-week",
  "reservation",
  "reservations-list",
  "owner-upcoming",
  "owner-bookings",
];

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  for (const key of INVALIDATE_KEYS) qc.invalidateQueries({ queryKey: [key] });
}

export function useCheckIn() {
  const qc = useQueryClient();
  const { user, membership } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      reservationId: string;
      petName?: string;
      assignment?:
        | { kind: "playgroup"; playgroup_id: string; pet_id: string }
        | { kind: "kennel"; kennel_run_id: string; pet_id: string }
        | null;
    }) => {
      const { error } = await supabase
        .from("reservations")
        .update({
          status: "checked_in",
          checked_in_at: new Date().toISOString(),
          checked_in_by_user_id: user?.id ?? null,
        })
        .eq("id", params.reservationId);
      if (error) throw error;

      if (params.assignment && membership?.organization_id) {
        if (params.assignment.kind === "playgroup") {
          await supabase.from("playgroup_assignments").insert({
            playgroup_id: params.assignment.playgroup_id,
            pet_id: params.assignment.pet_id,
            reservation_id: params.reservationId,
            organization_id: membership.organization_id,
            assigned_by_user_id: user?.id ?? null,
          });
        } else {
          await supabase.from("kennel_run_assignments").insert({
            kennel_run_id: params.assignment.kennel_run_id,
            pet_id: params.assignment.pet_id,
            reservation_id: params.reservationId,
            organization_id: membership.organization_id,
            assigned_by_user_id: user?.id ?? null,
          });
        }
      }

      if (membership?.organization_id) {
        await supabase.from("activity_log").insert({
          organization_id: membership.organization_id,
          actor_id: user?.id ?? null,
          action: "checked_in",
          entity_type: "reservation",
          entity_id: params.reservationId,
        });
      }
      return params;
    },
    onSuccess: (params) => {
      toast.success(`${params.petName ?? "Pet"} checked in`);
      invalidateAll(qc);
    },
    onError: (e: any) => toast.error(pgErrorToMessage(e, "Check-in failed")),
  });
}

export function useCheckOut() {
  const qc = useQueryClient();
  const { user, membership } = useAuth();

  return useMutation({
    mutationFn: async (params: { reservationId: string; petName?: string; createInvoice?: boolean }) => {
      const { error } = await supabase
        .from("reservations")
        .update({
          status: "checked_out",
          checked_out_at: new Date().toISOString(),
          checked_out_by_user_id: user?.id ?? null,
        })
        .eq("id", params.reservationId);
      if (error) throw error;

      if (membership?.organization_id) {
        await supabase.from("activity_log").insert({
          organization_id: membership.organization_id,
          actor_id: user?.id ?? null,
          action: "checked_out",
          entity_type: "reservation",
          entity_id: params.reservationId,
        });
      }

      let invoice: Awaited<ReturnType<typeof createInvoiceForReservation>> | null = null;
      if (params.createInvoice !== false) {
        try {
          invoice = await createInvoiceForReservation(params.reservationId);
        } catch (e: any) {
          // surface, but don't fail the whole checkout
          toast.error(`Invoice creation failed: ${e.message ?? "unknown"}`);
        }
      }
      return { ...params, invoice };
    },
    onSuccess: (params) => {
      toast.success(`${params.petName ?? "Pet"} checked out`);
      if (params.invoice && !params.invoice.alreadyExisted) {
        toast.success(`Invoice ${params.invoice.invoice_number ?? ""} created`, {
          action: {
            label: "View",
            onClick: () => window.location.assign(`/invoices/${params.invoice!.id}`),
          },
        });
      }
      invalidateAll(qc);
    },
    onError: (e: any) => toast.error(pgErrorToMessage(e, "Check-out failed")),
  });
}

export function useMarkNoShow() {
  const qc = useQueryClient();
  const { user, membership } = useAuth();
  return useMutation({
    mutationFn: async (params: { reservationId: string; petName?: string }) => {
      const { error } = await supabase
        .from("reservations")
        .update({ status: "no_show" })
        .eq("id", params.reservationId);
      if (error) throw error;
      if (membership?.organization_id) {
        await supabase.from("activity_log").insert({
          organization_id: membership.organization_id,
          actor_id: user?.id ?? null,
          action: "no_show",
          entity_type: "reservation",
          entity_id: params.reservationId,
        });
      }
      return params;
    },
    onSuccess: (params) => {
      toast.success(`${params.petName ?? "Pet"} marked no-show`);
      invalidateAll(qc);
    },
    onError: (e: any) => toast.error(pgErrorToMessage(e, "Could not mark no-show")),
  });
}
