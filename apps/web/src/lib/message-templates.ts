import { supabase } from "@/integrations/supabase/client";

/**
 * Per-organization, per-channel, per-event, optionally per-service-module
 * and per-location message templates. Resolution order is most-specific
 * first across the (service_module, location_id) axes:
 *
 *   1. (org, channel, event, module, location)        — both axes match
 *   2. (org, channel, event, module, NULL location)   — module-specific, org-wide
 *   3. (org, channel, event, NULL module, location)   — location-specific, any service
 *   4. (org, channel, event, NULL module, NULL)       — org-wide default
 *   5. null (caller falls back to the hardcoded default in email-templates.ts)
 *
 * Rows with a non-null location_id are EXCLUDED when no location is
 * supplied. That keeps a location-specific row from accidentally getting
 * applied to a different location's email until the senders are wired to
 * pass location_id.
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
  location_id?: string | null;
}): Promise<ResolvedTemplate | null> {
  const { data, error } = await supabase
    .from("message_templates")
    .select("id, subject, body, service_module, location_id")
    .eq("organization_id", args.organization_id)
    .eq("channel", args.channel)
    .eq("event_type", args.event_type)
    .eq("active", true)
    .is("deleted_at", null);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const wantedModule = args.service_module ?? null;
  const wantedLocation = args.location_id ?? null;

  // Filter the candidate set so a location-specific template never
  // matches a request for a different location. Without this, a row
  // tagged for Location A could be applied to Location B's email.
  const candidates = data.filter((t) => {
    if (t.location_id == null) return true;
    return t.location_id === wantedLocation;
  });
  if (candidates.length === 0) return null;

  // Most-specific-first: both axes match > module-only match >
  // location-only match > org default.
  const both = candidates.find(
    (t) => t.service_module === wantedModule && t.location_id === wantedLocation,
  );
  const moduleOnly = candidates.find(
    (t) => t.service_module === wantedModule && t.location_id == null,
  );
  const locationOnly = candidates.find(
    (t) => t.service_module == null && t.location_id === wantedLocation,
  );
  const orgDefault = candidates.find(
    (t) => t.service_module == null && t.location_id == null,
  );
  const chosen = both ?? moduleOnly ?? locationOnly ?? orgDefault;
  if (!chosen) return null;

  return {
    id: chosen.id,
    subject: chosen.subject ?? null,
    body: chosen.body ?? "",
    module_specific: chosen.service_module != null,
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
/**
 * Text-only variant for SMS: resolves a per-org template and renders
 * it against `vars`, falling back to a hardcoded short string if no
 * template applies. Mirrors `resolveOrFallback` but returns a single
 * string instead of `{subject, html}` because SMS has no subject and
 * no HTML markup. The fallback is invoked lazily so the import graph
 * doesn't pay for SMS templates that never fire.
 */
export async function resolveOrFallbackText(args: {
  organization_id: string;
  channel: MessageChannel;
  event_type: MessageEventType;
  service_module?: ServiceModule | null;
  location_id?: string | null;
  vars: Record<string, string | number | null | undefined>;
  fallback: () => string;
}): Promise<string> {
  const tpl = await resolveTemplate({
    organization_id: args.organization_id,
    channel: args.channel,
    event_type: args.event_type,
    service_module: args.service_module ?? null,
    location_id: args.location_id ?? null,
  });
  if (tpl?.body) {
    return renderTemplate(tpl.body, args.vars);
  }
  return args.fallback();
}

export async function resolveOrFallback(args: {
  organization_id: string;
  channel: MessageChannel;
  event_type: MessageEventType;
  service_module?: ServiceModule | null;
  location_id?: string | null;
  vars: Record<string, string | number | null | undefined>;
  fallback: () => { subject: string; html: string };
}): Promise<{ subject: string; html: string }> {
  const tpl = await resolveTemplate({
    organization_id: args.organization_id,
    channel: args.channel,
    event_type: args.event_type,
    service_module: args.service_module ?? null,
    location_id: args.location_id ?? null,
  });
  if (tpl?.subject && tpl.body) {
    return {
      subject: renderTemplate(tpl.subject, args.vars),
      html: renderTemplate(tpl.body, args.vars),
    };
  }
  return args.fallback();
}
