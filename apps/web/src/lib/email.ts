import { supabase } from "@/integrations/supabase/client";
import {
  reservationConfirmationEmail,
  invoiceCreatedEmail,
  reportCardEmail,
  waiverReminderEmail,
  petBirthdayEmail,
} from "./email-templates";
import { dispatchOwnerPush } from "./push";

// Best-effort push dispatch alongside email. Fire-and-forget — the
// caller already has the email send to await on, and a push failure
// must not abort the email path. We swallow errors and log so the
// browser console makes the silent failure visible during testing.
function firePushBeside(args: {
  owner_id?: string;
  title: string;
  body: string;
  url?: string;
  tag?: string;
}) {
  if (!args.owner_id) return;
  void dispatchOwnerPush({
    owner_id: args.owner_id,
    kind: "report_card_published",
    title: args.title,
    body: args.body,
    url: args.url,
    tag: args.tag,
  }).catch((e) => console.warn("push fan-out failed:", e));
}

export type EmailType = "reservation" | "invoice" | "report_card" | "waiver" | "auth" | "birthday";

interface SendEmailParams {
  to: string;
  subject: string;
  html_body: string;
  from_name?: string;
  organization_id?: string;
  email_type?: EmailType;
}

export async function sendEmail(params: SendEmailParams) {
  const { data, error } = await supabase.functions.invoke("send-email", { body: params });
  if (error) {
    console.error("sendEmail error:", error);
    return { success: false, error: error.message };
  }
  return data as { success: boolean; message_id?: string; error?: string };
}

interface OrgInfo {
  id: string;
  name: string;
}

async function loadEmailContext(organizationId: string) {
  const [{ data: settings }, { data: org }] = await Promise.all([
    supabase
      .from("email_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase.from("organizations").select("id, name").eq("id", organizationId).maybeSingle(),
  ]);
  return { settings, org: org as OrgInfo | null };
}

// 1. Reservation confirmation
export async function sendReservationConfirmation(args: {
  organization_id: string;
  to: string;
  pet_names: string[];
  service_name: string;
  service_module?: "daycare" | "boarding" | "grooming" | "training" | "retail" | null;
  start_at: string;
  location_name: string;
  location_id?: string | null;
  reservation_id: string;
  owner_first_name?: string;
  owner_id?: string;
}) {
  // Push fan-out alongside email. Independent of email success so an
  // owner with notifications enabled but a bouncing email still sees
  // the confirmation.
  firePushBeside({
    owner_id: args.owner_id,
    title: "Booking confirmed",
    body: `${args.pet_names.join(", ")} - ${args.service_name} at ${args.location_name}.`,
    url: `/portal/reservations/${args.reservation_id}`,
    tag: `reservation-${args.reservation_id}`,
  });
  const { settings, org } = await loadEmailContext(args.organization_id);
  if (!org) return { success: false, error: "Org not found" };
  if (settings && settings.reservation_confirmation_enabled === false) {
    return { success: false, error: "Disabled by settings", skipped: true };
  }

  const { resolveOrFallback } = await import("./message-templates");
  const { subject, html } = await resolveOrFallback({
    organization_id: org.id,
    channel: "email",
    event_type: "reservation_confirmation",
    service_module: args.service_module ?? null,
    location_id: args.location_id ?? null,
    vars: {
      pet_names: args.pet_names.join(", "),
      service_name: args.service_name,
      start_at: args.start_at,
      location_name: args.location_name,
      reservation_id: args.reservation_id,
      org_name: org.name,
      owner_first_name: args.owner_first_name ?? "",
    },
    fallback: () =>
      reservationConfirmationEmail({
        pet_names: args.pet_names,
        service_name: args.service_name,
        start_at: args.start_at,
        location_name: args.location_name,
        reservation_id: args.reservation_id,
        org_name: org.name,
        owner_first_name: args.owner_first_name,
      }),
  });

  return sendEmail({
    to: args.to,
    subject,
    html_body: html,
    from_name: settings?.sender_name || org.name,
    organization_id: org.id,
    email_type: "reservation",
  });
}

// 2. Invoice created
export async function sendInvoiceCreated(args: {
  organization_id: string;
  to: string;
  invoice_number: string;
  amount_display: string;
  due_date: string;
  invoice_id: string;
  pay_now_url?: string;
  owner_id?: string;
  location_id?: string | null;
}) {
  firePushBeside({
    owner_id: args.owner_id,
    title: `Invoice ${args.invoice_number}`,
    body: `${args.amount_display} due ${args.due_date}.`,
    url: `/portal/invoices/${args.invoice_id}`,
    tag: `invoice-${args.invoice_id}`,
  });
  const { settings, org } = await loadEmailContext(args.organization_id);
  if (!org) return { success: false, error: "Org not found" };
  if (settings && settings.invoice_created_enabled === false) {
    return { success: false, error: "Disabled by settings", skipped: true };
  }
  const { resolveOrFallback } = await import("./message-templates");
  const { subject, html } = await resolveOrFallback({
    organization_id: org.id,
    channel: "email",
    event_type: "invoice_created",
    location_id: args.location_id ?? null,
    vars: {
      invoice_number: args.invoice_number,
      amount_display: args.amount_display,
      due_date: args.due_date,
      invoice_id: args.invoice_id,
      org_name: org.name,
      pay_now_url: args.pay_now_url ?? "",
    },
    fallback: () =>
      invoiceCreatedEmail({
        invoice_number: args.invoice_number,
        amount_display: args.amount_display,
        due_date: args.due_date,
        invoice_id: args.invoice_id,
        org_name: org.name,
        pay_now_url: args.pay_now_url,
      }),
  });
  return sendEmail({
    to: args.to,
    subject,
    html_body: html,
    from_name: settings?.sender_name || org.name,
    organization_id: org.id,
    email_type: "invoice",
  });
}

// 3. Report card published
export async function sendReportCardPublished(args: {
  organization_id: string;
  to: string;
  pet_name: string;
  rating?: string | null;
  rating_emoji?: string | null;
  mood_summary?: string | null;
  visit_notes?: string | null;
  photo_url?: string | null;
  reservation_id: string;
  report_card_id?: string;
  owner_id?: string;
  location_id?: string | null;
}) {
  firePushBeside({
    owner_id: args.owner_id,
    title: `${args.pet_name}'s report card is here`,
    body: args.mood_summary?.slice(0, 120) ?? "Tap to see how the visit went.",
    url: args.report_card_id
      ? `/portal/report-cards/${args.report_card_id}`
      : `/portal/reservations/${args.reservation_id}`,
    tag: args.report_card_id ? `report-card-${args.report_card_id}` : undefined,
  });
  const { settings, org } = await loadEmailContext(args.organization_id);
  if (!org) return { success: false, error: "Org not found" };
  if (settings && settings.report_card_published_enabled === false) {
    return { success: false, error: "Disabled by settings", skipped: true };
  }
  const { resolveOrFallback } = await import("./message-templates");
  const { subject, html } = await resolveOrFallback({
    organization_id: org.id,
    channel: "email",
    event_type: "report_card_published",
    location_id: args.location_id ?? null,
    vars: {
      pet_name: args.pet_name,
      rating: args.rating ?? "",
      rating_emoji: args.rating_emoji ?? "",
      mood_summary: args.mood_summary ?? "",
      visit_notes: args.visit_notes ?? "",
      photo_url: args.photo_url ?? "",
      reservation_id: args.reservation_id,
      org_name: org.name,
    },
    fallback: () =>
      reportCardEmail({
        pet_name: args.pet_name,
        rating: args.rating,
        rating_emoji: args.rating_emoji,
        mood_summary: args.mood_summary,
        visit_notes: args.visit_notes,
        photo_url: args.photo_url,
        reservation_id: args.reservation_id,
        org_name: org.name,
      }),
  });
  return sendEmail({
    to: args.to,
    subject,
    html_body: html,
    from_name: settings?.sender_name || org.name,
    organization_id: org.id,
    email_type: "report_card",
  });
}

// 5. Pet birthday — fired by the daily birthday cron. Resolves the
// org's per-event template (event_type='birthday') with optional
// per-service-module overrides; falls back to the hardcoded
// `petBirthdayEmail` shell. Skipped if EmailSettings have a future
// birthday-disable toggle (not present today; reserved).
export async function sendPetBirthday(args: {
  organization_id: string;
  to: string;
  pet_name: string;
  age?: number | null;
  owner_first_name?: string;
  location_id?: string | null;
}) {
  const { settings, org } = await loadEmailContext(args.organization_id);
  if (!org) return { success: false, error: "Org not found" };
  const { resolveOrFallback } = await import("./message-templates");
  const { subject, html } = await resolveOrFallback({
    organization_id: org.id,
    channel: "email",
    event_type: "birthday",
    location_id: args.location_id ?? null,
    vars: {
      pet_name: args.pet_name,
      age: args.age ?? "",
      org_name: org.name,
      owner_first_name: args.owner_first_name ?? "",
    },
    fallback: () =>
      petBirthdayEmail({
        pet_name: args.pet_name,
        age: args.age,
        org_name: org.name,
        owner_first_name: args.owner_first_name,
      }),
  });
  return sendEmail({
    to: args.to,
    subject,
    html_body: html,
    from_name: settings?.sender_name || org.name,
    organization_id: org.id,
    email_type: "birthday" as EmailType,
  });
}

// 4. Waiver reminder
export async function sendWaiverReminder(args: {
  organization_id: string;
  to: string;
  waiver_titles: string[];
  owner_first_name?: string;
  location_id?: string | null;
}) {
  const { settings, org } = await loadEmailContext(args.organization_id);
  if (!org) return { success: false, error: "Org not found" };
  if (settings && settings.waiver_reminder_enabled === false) {
    return { success: false, error: "Disabled by settings", skipped: true };
  }
  const { resolveOrFallback } = await import("./message-templates");
  const { subject, html } = await resolveOrFallback({
    organization_id: org.id,
    channel: "email",
    event_type: "waiver_reminder",
    location_id: args.location_id ?? null,
    vars: {
      waiver_titles: args.waiver_titles.join(", "),
      org_name: org.name,
      owner_first_name: args.owner_first_name ?? "",
    },
    fallback: () =>
      waiverReminderEmail({
        waiver_titles: args.waiver_titles,
        org_name: org.name,
        owner_first_name: args.owner_first_name,
      }),
  });
  return sendEmail({
    to: args.to,
    subject,
    html_body: html,
    from_name: settings?.sender_name || org.name,
    organization_id: org.id,
    email_type: "waiver",
  });
}
