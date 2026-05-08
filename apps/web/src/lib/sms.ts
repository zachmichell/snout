// SMS senders. Mirror the structure of lib/email.ts so a future
// reader who already understands the email path can read this in
// seconds. Each sender:
//   1. honors the owner's communication_preference (skip if email-only)
//   2. resolves a per-org SMS template via message_templates
//      (channel='sms') with optional service-module + location overrides
//   3. falls back to a hardcoded template from lib/sms-templates.ts
//   4. invokes the send-sms edge function which dispatches via Twilio
//      and writes one row to sms_log
//
// Phone-number normalization happens server-side in send-sms; callers
// pass whatever the owner record has.

import { supabase } from "@/integrations/supabase/client";
import {
  reservationReminderSms,
  waiverReminderSms,
} from "./sms-templates";
import { resolveOrFallbackText } from "./message-templates";

export type SmsType =
  | "reservation_reminder"
  | "waiver_reminder"
  | "reservation_confirmation"
  | "check_in"
  | "check_out"
  | "birthday";

interface SendSmsParams {
  to: string;
  body: string;
  organization_id: string;
  sms_type?: SmsType;
  reservation_id?: string;
  owner_id?: string;
}

export async function sendSms(params: SendSmsParams) {
  const { data, error } = await supabase.functions.invoke("send-sms", {
    body: params,
  });
  if (error) {
    return { success: false, error: error.message ?? String(error) };
  }
  return data as { success: boolean; sid?: string; status?: string; error?: string };
}

// Owner has opted in to SMS for this kind of message.
function shouldSendSms(communicationPreference: string | null | undefined, phone: string | null | undefined): boolean {
  if (!phone) return false;
  // 'sms' or 'both' -> send. 'email' -> skip. null -> skip (default to
  // email-only until the owner explicitly opts in).
  return communicationPreference === "sms" || communicationPreference === "both";
}

// 1. Reservation reminder (24h out — used by send-reservation-reminders cron)
export async function sendReservationReminder(args: {
  organization_id: string;
  owner_id?: string;
  reservation_id: string;
  to: string;
  pet_name: string;
  service_name: string;
  start_at_display: string;     // already formatted for the recipient
  org_name: string;
  service_module?: "daycare" | "boarding" | "grooming" | "training" | "retail" | null;
  location_id?: string | null;
  // Caller checks the owner's preference and supplies these so we can
  // gate without an extra lookup.
  communication_preference?: string | null;
  phone?: string | null;
}) {
  if (!shouldSendSms(args.communication_preference, args.phone ?? args.to)) {
    return { success: false, skipped: true, error: "Owner not opted in to SMS or no phone" };
  }
  const text = await resolveOrFallbackText({
    organization_id: args.organization_id,
    channel: "sms",
    event_type: "reservation_reminder",
    service_module: args.service_module ?? null,
    location_id: args.location_id ?? null,
    vars: {
      pet_name: args.pet_name,
      service_name: args.service_name,
      start_at: args.start_at_display,
      org_name: args.org_name,
    },
    fallback: () =>
      reservationReminderSms({
        pet_name: args.pet_name,
        service_name: args.service_name,
        start_at: args.start_at_display,
        org_name: args.org_name,
      }),
  });
  return sendSms({
    to: args.to,
    body: text,
    organization_id: args.organization_id,
    sms_type: "reservation_reminder",
    reservation_id: args.reservation_id,
    owner_id: args.owner_id,
  });
}

// 2. Waiver reminder
export async function sendWaiverReminderSms(args: {
  organization_id: string;
  owner_id?: string;
  to: string;
  waiver_count: number;
  org_name: string;
  location_id?: string | null;
  communication_preference?: string | null;
  phone?: string | null;
}) {
  if (!shouldSendSms(args.communication_preference, args.phone ?? args.to)) {
    return { success: false, skipped: true, error: "Owner not opted in to SMS or no phone" };
  }
  const text = await resolveOrFallbackText({
    organization_id: args.organization_id,
    channel: "sms",
    event_type: "waiver_reminder",
    location_id: args.location_id ?? null,
    vars: {
      waiver_count: args.waiver_count,
      org_name: args.org_name,
    },
    fallback: () =>
      waiverReminderSms({
        waiver_count: args.waiver_count,
        org_name: args.org_name,
      }),
  });
  return sendSms({
    to: args.to,
    body: text,
    organization_id: args.organization_id,
    sms_type: "waiver_reminder",
    owner_id: args.owner_id,
  });
}
