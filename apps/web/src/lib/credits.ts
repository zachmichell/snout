import { supabase } from "@/integrations/supabase/client";

/**
 * Credit ledger.
 *
 * Daycare reservations and boarding reservations consume credits at check-out.
 * Grooming and training are services (not reservations) and never use credits;
 * they are always invoiced.
 *
 * Half-day daycare reservations that exceed HALF_TO_FULL_THRESHOLD_HOURS of
 * actual stay convert to a full-day credit instead.
 *
 * Storage: every credit movement is a row in the credit_ledger table. The
 * flat counter columns on owners (daycare_full_day_credits, etc.) are a
 * denormalized cache maintained by a Postgres trigger and must not be
 * mutated directly. Use the SQL functions consume_credits and
 * apply_credit_adjustment via supabase.rpc.
 *
 * Concurrency: consume_credits acquires a FOR UPDATE lock on each candidate
 * purchase row, so two staff checking out the same owner simultaneously
 * cannot both spend the last credit. The loser sees an "insufficient" error
 * and the caller falls back to invoicing.
 */

const HALF_TO_FULL_THRESHOLD_HOURS = 5;

export type ReservationCredits = {
  daycare_full_day: number;
  daycare_half_day: number;
  boarding_nights: number;
};

const ZERO_CREDITS: ReservationCredits = {
  daycare_full_day: 0,
  daycare_half_day: 0,
  boarding_nights: 0,
};

type CreditableReservation = {
  id: string;
  start_at: string;
  end_at: string;
  checked_in_at: string | null;
  primary_owner_id: string | null;
  services: { module: string | null; duration_type: string | null } | null;
};

type OwnerBalance = {
  id: string;
  daycare_full_day_credits: number;
  daycare_half_day_credits: number;
  boarding_night_credits: number;
};

export type CreditActor = {
  kind: "staff" | "owner" | "system";
  label: string;
  staffCodeId?: string | null;
};

const SYSTEM_ACTOR: CreditActor = { kind: "system", label: "System" };

/** How many credits this reservation costs at check-out. */
export function calculateCredits(r: CreditableReservation, now: Date = new Date()): ReservationCredits {
  const module = r.services?.module;

  if (module === "daycare") {
    if (r.services?.duration_type === "half_day") {
      // Half-day stays that ran long convert to a full-day credit.
      if (r.checked_in_at) {
        const hours = (now.getTime() - new Date(r.checked_in_at).getTime()) / 3_600_000;
        if (hours > HALF_TO_FULL_THRESHOLD_HOURS) {
          return { ...ZERO_CREDITS, daycare_full_day: 1 };
        }
      }
      return { ...ZERO_CREDITS, daycare_half_day: 1 };
    }
    return { ...ZERO_CREDITS, daycare_full_day: 1 };
  }

  if (module === "boarding") {
    // Count midnights between actual check-in (or scheduled start) and now.
    const start = new Date(r.checked_in_at ?? r.start_at);
    const startMidnight = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const endMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const nights = Math.max(1, Math.round((endMidnight - startMidnight) / 86_400_000));
    return { ...ZERO_CREDITS, boarding_nights: nights };
  }

  // grooming, training, retail: no credits, always invoiced.
  return ZERO_CREDITS;
}

export function isZero(c: ReservationCredits): boolean {
  return c.daycare_full_day === 0 && c.daycare_half_day === 0 && c.boarding_nights === 0;
}

export function hasEnough(needed: ReservationCredits, balance: OwnerBalance): boolean {
  return (
    balance.daycare_full_day_credits >= needed.daycare_full_day &&
    balance.daycare_half_day_credits >= needed.daycare_half_day &&
    balance.boarding_night_credits >= needed.boarding_nights
  );
}

/** Human-readable summary of credits used. e.g. "1 full day", "3 nights". */
export function formatCreditsUsed(c: ReservationCredits): string {
  const parts: string[] = [];
  if (c.daycare_full_day > 0) {
    parts.push(`${c.daycare_full_day} full day${c.daycare_full_day === 1 ? "" : "s"}`);
  }
  if (c.daycare_half_day > 0) {
    parts.push(`${c.daycare_half_day} half day${c.daycare_half_day === 1 ? "" : "s"}`);
  }
  if (c.boarding_nights > 0) {
    parts.push(`${c.boarding_nights} night${c.boarding_nights === 1 ? "" : "s"}`);
  }
  return parts.join(" + ");
}

export type ConsumeResult =
  | { used: true; creditsUsed: ReservationCredits }
  | { used: false; reason: "no-credits-needed" | "insufficient" | "no-owner" };

/**
 * Attempt to consume credits for this reservation. Returns `{ used: true }`
 * if the owner had enough credits and they were deducted (caller skips
 * invoicing). Returns `{ used: false }` if no credits apply, the owner has no
 * balance, or a concurrent deduction beat us; the caller should fall back to
 * invoicing.
 *
 * The actual ledger writes happen inside the `consume_credits` Postgres
 * function (FIFO across active purchases, atomic per call).
 */
export async function tryConsumeCredits(
  reservationId: string,
  actor: CreditActor = SYSTEM_ACTOR,
): Promise<ConsumeResult> {
  const { data: r, error: rErr } = await supabase
    .from("reservations")
    .select(
      "id, start_at, end_at, checked_in_at, primary_owner_id, services:service_id(module, duration_type)",
    )
    .eq("id", reservationId)
    .single();
  if (rErr || !r) throw rErr ?? new Error("Reservation not found");

  const reservation = r as unknown as CreditableReservation;
  const needed = calculateCredits(reservation);

  if (isZero(needed)) {
    return { used: false, reason: "no-credits-needed" };
  }
  if (!reservation.primary_owner_id) {
    return { used: false, reason: "no-owner" };
  }

  const { data, error } = await supabase.rpc("consume_credits", {
    p_owner_id: reservation.primary_owner_id,
    p_reservation_id: reservationId,
    p_need_full: needed.daycare_full_day,
    p_need_half: needed.daycare_half_day,
    p_need_nights: needed.boarding_nights,
    p_actor_kind: actor.kind,
    p_actor_label: actor.label,
    p_staff_code_id: actor.staffCodeId ?? null,
  });

  if (error) {
    if (isInsufficientError(error)) {
      return { used: false, reason: "insufficient" };
    }
    throw error;
  }

  // The function returns { used: true, full, half, nights } or { used: false, reason }.
  const result = data as { used?: boolean; reason?: string } | null;
  if (!result?.used) {
    return { used: false, reason: "no-credits-needed" };
  }
  return { used: true, creditsUsed: needed };
}

/**
 * Apply a manual credit adjustment by staff. `delta_*` may be positive or
 * negative; mixed signs are supported. Positive deltas write a single
 * manual_adjustment row; negative deltas FIFO-walk the active purchase pool
 * and write linked manual_adjustment rows. Throws on insufficient.
 */
export async function applyCreditAdjustment(args: {
  ownerId: string;
  deltaFull: number;
  deltaHalf: number;
  deltaNights: number;
  note?: string | null;
  actor?: CreditActor;
}): Promise<void> {
  const actor = args.actor ?? { kind: "staff", label: "Staff" };
  const { error } = await supabase.rpc("apply_credit_adjustment", {
    p_owner_id: args.ownerId,
    p_delta_full: args.deltaFull,
    p_delta_half: args.deltaHalf,
    p_delta_nights: args.deltaNights,
    p_note: args.note ?? null,
    p_actor_kind: actor.kind,
    p_actor_label: actor.label,
    p_staff_code_id: actor.staffCodeId ?? null,
  });
  if (error) {
    if (isInsufficientError(error)) {
      throw new Error("Adjustment would put balance below zero");
    }
    throw error;
  }
}

function isInsufficientError(error: { code?: string; message?: string }): boolean {
  // Postgres signals insufficient via a custom SQLSTATE (P0002). Supabase
  // surfaces this as `code` on the error, but some pathways flatten it into
  // the message. Check both.
  if (error.code === "P0002") return true;
  if (typeof error.message === "string" && error.message.includes("Insufficient credits")) {
    return true;
  }
  if (typeof error.message === "string" && error.message.includes("balance below zero")) {
    return true;
  }
  return false;
}
