// Client-callable helpers for triggering Web Push fan-out from the
// browser. Mirrors the shape of lib/email's senders so a UI mutation
// can fire both surfaces in parallel.
//
// The actual delivery is handled server-side by the
// send-push-notification edge function. We do NOT call that function
// from the browser directly because it requires service-role
// authorization. Instead we POST through `supabase.functions.invoke`
// with the user's JWT, which lands at a separate
// `dispatch-owner-push` function (added in 5b) that resolves the
// owner -> profile relationship and forwards to send-push-notification.
//
// In practice today there is no dispatch function — the email senders
// were extended to accept an optional `owner_id` and the front end
// calls a single trampoline. Keeping the helper here so future
// templates can land alongside without touching email.ts.
import { supabase } from "@/integrations/supabase/client";

export type OwnerPushKind =
  | "report_card_published"
  | "reservation_confirmed"
  | "invoice_created"
  | "payment_received"
  | "photo_uploaded";

export type OwnerPushArgs = {
  owner_id: string;
  kind: OwnerPushKind;
  title: string;
  body: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
};

export async function dispatchOwnerPush(args: OwnerPushArgs) {
  const { data, error } = await supabase.functions.invoke("dispatch-owner-push", {
    body: args,
  });
  if (error) {
    console.warn("dispatchOwnerPush error:", error);
    return { ok: false, error: error.message };
  }
  return data as { ok: boolean; sent?: number };
}
