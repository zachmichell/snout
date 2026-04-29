import { supabase } from "@/integrations/supabase/client";

export type ActivityEntity =
  | "reservation"
  | "invoice"
  | "payment"
  | "pet"
  | "owner"
  | "settings"
  | "import"
  | "merge"
  | "service"
  | "checkin"
  | "checkout"
  | "vaccination"
  | "agreement"
  | "waiver_signature"
  | "document";

export type ActivityAction =
  | "created"
  | "updated"
  | "confirmed"
  | "cancelled"
  | "deleted"
  | "checked_in"
  | "checked_out"
  | "no_show"
  | "commented"
  | "paid"
  | "refunded"
  | "imported"
  | "merged"
  | "uploaded"
  | "photo_uploaded"
  | "signed";

export type ActorKind = "staff" | "owner" | "system";

/**
 * Who performed the action. Stored in the activity_log row's `metadata` so
 * display surfaces don't have to join staff_codes/owners to render the actor.
 *
 * - `staff` — a staff member identified by their PIN (StaffCodeContext)
 * - `owner` — a pet owner self-serving from the owner portal
 * - `system` — automated jobs, cron, server-side triggers
 */
export type ActivityActor = {
  kind: ActorKind;
  label: string; // display text — e.g. "Sarah Chen", "Owner", "System"
  staff_code_id?: string | null;
};

export async function logActivity(params: {
  organization_id: string;
  action: ActivityAction | string;
  entity_type: ActivityEntity | string;
  entity_id?: string | null;
  metadata?: Record<string, unknown> | null;
  actor?: ActivityActor;
}) {
  const { data: { user } } = await supabase.auth.getUser();
  const actor = params.actor;
  const merged: Record<string, unknown> = {
    ...(params.metadata ?? {}),
    actor_kind: actor?.kind ?? "system",
    actor_label: actor?.label ?? "System",
  };
  if (actor?.staff_code_id) merged.staff_code_id = actor.staff_code_id;

  await supabase.from("activity_log").insert({
    organization_id: params.organization_id,
    actor_id: user?.id ?? null,
    action: params.action,
    entity_type: params.entity_type,
    entity_id: params.entity_id ?? null,
    metadata: merged as any,
  });
}
