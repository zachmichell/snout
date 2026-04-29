import { supabase } from "@/integrations/supabase/client";

/**
 * Per-organization, per-channel, per-event, optionally per-service-module
 * message templates. Resolution order is most-specific first:
 *
 *   1. (org, channel, event_type, service_module)
 *   2. (org, channel, event_type, NULL)
 *   3. null  (caller falls back to the hardcoded default in email-templates.ts)
 *
 * Templates use {{token}} placeholders. `renderTemplate` substitutes a flat
 * key-value bag into the template body; unknown tokens render as empty
 * strings rather than leaving the literal placeholder visible to the
 * recipient.
 */

export type MessageChannel = "email" | "sms";

export type MessageEventType =
  | "reservation_confirmation"
  | "invoice_created"
  | "report_card_published"
  | "waiver_reminder"
  | "reservation_reminder"
  | "birthday";

export type ServiceModule = "daycare" | "boarding" | "grooming" | "training" | "retail";

export type ResolvedTemplate = {
  id: string;
  subject: string | null;
  body: string;
  /** Whether the resolved row was a module-specific override (true) or the org default (false). */
  module_specific: boolean;
};

export async function resolveTemplate(args: {
  organization_id: string;
  channel: MessageChannel;
  event_type: MessageEventType;
  service_module?: ServiceModule | null;
}): Promise<ResolvedTemplate | null> {
  const { data, error } = await supabase
    .from("message_templates")
    .select("id, subject, body, service_module")
    .eq("organization_id", args.organization_id)
    .eq("channel", args.channel)
    .eq("event_type", args.event_type)
    .eq("active", true)
    .is("deleted_at", null);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  // Prefer the row whose service_module matches the requested one; fall back
  // to the row with NULL service_module (the org's default for this event).
  const wanted = args.service_module ?? null;
  const specific = data.find((t) => t.service_module === wanted) ?? null;
  const fallback = data.find((t) => t.service_module === null) ?? null;
  const chosen = specific ?? fallback;
  if (!chosen) return null;

  return {
    id: chosen.id,
    subject: chosen.subject ?? null,
    body: chosen.body ?? "",
    module_specific: specific !== null && specific.service_module !== null,
  };
}

/**
 * Substitutes `{{token}}` placeholders in a template body. Tokens are
 * matched case-sensitively against the keys of `vars`. Unknown tokens
 * render as empty strings.
 *
 * Pure function. No side effects, no IO. Covered by unit tests.
 */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return "";
    return String(v);
  });
}

/**
 * Common path for the email senders: try to resolve a per-org (and optionally
 * per-module) template, render it against `vars`, and fall back to the
 * hardcoded default if no template applies. Keeps the four senders in
 * email.ts symmetrical and short.
 */
export async function resolveOrFallback(args: {
  organization_id: string;
  channel: MessageChannel;
  event_type: MessageEventType;
  service_module?: ServiceModule | null;
  vars: Record<string, string | number | null | undefined>;
  fallback: () => { subject: string; html: string };
}): Promise<{ subject: string; html: string }> {
  const tpl = await resolveTemplate({
    organization_id: args.organization_id,
    channel: args.channel,
    event_type: args.event_type,
    service_module: args.service_module ?? null,
  });
  if (tpl?.subject && tpl.body) {
    return {
      subject: renderTemplate(tpl.subject, args.vars),
      html: renderTemplate(tpl.body, args.vars),
    };
  }
  return args.fallback();
}
