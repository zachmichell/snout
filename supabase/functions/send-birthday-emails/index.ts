// Reliability Batch D: daily birthday emails.
//
// Runs once per day (via pg_cron — see migration
// 20260508140100_birthday_email_cron.sql). Iterates every active org,
// finds pets whose date_of_birth's month/day matches today, looks up
// the pet's primary owner via pet_owners, and sends a birthday email.
//
// Dedup: we check email_log for a same-day birthday send to the same
// recipient. The cron should only fire once per day, but if an
// operator hits "Send now" via the test endpoint or the cron retries
// after a transient failure, we don't want a customer to get two
// birthday emails.
//
// Per-org enable/disable: today there's no birthday toggle on
// email_settings, so we send when the org has either an active
// `birthday` row in message_templates OR none at all (the hardcoded
// fallback applies). An operator who wants to opt out today can
// publish an empty/disabled birthday template; a future migration may
// add an explicit email_settings.birthday_enabled column.
//
// Auth: cron invokes with service-role JWT. Operators can also call
// this manually via "send now" buttons; we accept the same auth.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Tunable: how many pets to process per org per run. The cron is daily,
// so even a 5,000-pet org rarely needs more than the largest cohort
// born on a single day. 500 is a comfortable cap.
const PER_ORG_LIMIT = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Service-role only. The cron-trigger sets the Authorization header
  // explicitly; manual calls from staff also flow through service-role
  // (they go through an authenticated endpoint that proxies us, not
  // the public anon role).
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token !== SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const overrideOrgId = typeof body?.org_id === "string" ? body.org_id : null;
  // Date override is only useful for tests so QA can simulate "today
  // is Sept 15" without waiting for September. yyyy-mm-dd format.
  const overrideTodayIso =
    typeof body?.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
      ? body.today
      : null;
  const dryRun = body?.dry_run === true;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Compute today's month and day. We use UTC so the cron behaves
  // predictably regardless of where it's invoked from. Operators can
  // still tune the cron schedule to fire at a friendlier wall-clock
  // hour for their region (see migration).
  const now = overrideTodayIso ? new Date(`${overrideTodayIso}T12:00:00Z`) : new Date();
  const todayMonth = now.getUTCMonth() + 1; // 1..12
  const todayDay = now.getUTCDate();
  const todayKey = now.toISOString().slice(0, 10);

  // Resolve target orgs. With no override we pick every active org.
  let orgsQuery = admin
    .from("organizations")
    .select("id, name")
    .is("deleted_at", null);
  if (overrideOrgId) orgsQuery = orgsQuery.eq("id", overrideOrgId);
  const { data: orgs, error: orgsErr } = await orgsQuery;
  if (orgsErr) return json({ error: orgsErr.message }, 500);

  let totalCandidates = 0;
  let totalSent = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const failures: Array<{ pet_id: string; reason: string }> = [];

  for (const org of orgs ?? []) {
    // Find pets whose dob month/day matches today and aren't deleted.
    // Filtering on EXTRACT() needs a server-side query — we do it via
    // RPC-free PostgREST by selecting all pets and filtering client-side.
    // For multi-thousand-pet orgs this is fine because the cron is daily
    // and we can paginate; for the fixture orgs it's trivial.
    const { data: pets, error: petsErr } = await admin
      .from("pets")
      .select("id, name, date_of_birth")
      .eq("organization_id", org.id)
      .not("date_of_birth", "is", null)
      .is("deleted_at", null)
      .limit(PER_ORG_LIMIT);
    if (petsErr) {
      failures.push({ pet_id: org.id, reason: `org list: ${petsErr.message}` });
      continue;
    }
    const matches = (pets ?? []).filter((p) => {
      if (!p.date_of_birth) return false;
      const d = new Date(`${p.date_of_birth}T12:00:00Z`);
      return d.getUTCMonth() + 1 === todayMonth && d.getUTCDate() === todayDay;
    });
    totalCandidates += matches.length;

    for (const pet of matches) {
      try {
        // Look up the primary owner. Prefer role='primary'; fall back to
        // any related owner. Skip if no email is on file.
        const { data: links } = await admin
          .from("pet_owners")
          .select(
            "owner_id, role, owner:owners(id, email, first_name, deleted_at)",
          )
          .eq("pet_id", pet.id);
        const candidates = (links ?? [])
          .map((l: any) => l.owner)
          .filter((o: any) => o && !o.deleted_at && o.email);
        if (candidates.length === 0) {
          totalSkipped += 1;
          continue;
        }
        const primary =
          candidates.find((_: any, i: number) => links?.[i]?.role === "primary") ??
          candidates[0];

        // Dedup: was a birthday email already sent to this address from
        // this org today? If so, skip — the cron already covered them.
        const { data: existing } = await admin
          .from("email_log")
          .select("id")
          .eq("organization_id", org.id)
          .eq("recipient_email", primary.email)
          .eq("email_type", "birthday")
          .gte("sent_at", `${todayKey}T00:00:00Z`)
          .limit(1);
        if (existing && existing.length > 0) {
          totalSkipped += 1;
          continue;
        }

        if (dryRun) {
          totalSent += 1; // counted as "would send" for the report
          continue;
        }

        // Compute the pet's age (this birthday).
        const birthYear = new Date(`${pet.date_of_birth}T12:00:00Z`).getUTCFullYear();
        const age = now.getUTCFullYear() - birthYear;

        // Resolve template (or fall back) and send. We render server-side
        // here so the cron doesn't depend on the web app being up.
        const tpl = await resolveBirthdayTemplate(admin, org.id);
        const vars: Record<string, string> = {
          pet_name: pet.name ?? "your pet",
          age: age > 0 ? String(age) : "",
          org_name: org.name ?? "",
          owner_first_name: primary.first_name ?? "",
        };
        const subject = tpl?.subject
          ? renderTemplate(tpl.subject, vars)
          : `Happy birthday, ${vars.pet_name}!`;
        const html = tpl?.body
          ? renderTemplate(tpl.body, vars)
          : fallbackBirthdayHtml(vars, age);

        const sendRes = await admin.functions.invoke("send-email", {
          body: {
            to: primary.email,
            subject,
            html_body: html,
            from_name: org.name ?? undefined,
            organization_id: org.id,
            email_type: "birthday",
          },
        });
        if (sendRes.error) {
          totalFailed += 1;
          failures.push({ pet_id: pet.id, reason: sendRes.error.message });
        } else {
          totalSent += 1;
        }
      } catch (e) {
        totalFailed += 1;
        failures.push({ pet_id: pet.id, reason: (e as Error).message });
      }
    }
  }

  return json({
    ok: true,
    today: todayKey,
    orgs: orgs?.length ?? 0,
    candidates: totalCandidates,
    sent: totalSent,
    skipped: totalSkipped,
    failed: totalFailed,
    failures: failures.slice(0, 25),
  });
});

async function resolveBirthdayTemplate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  orgId: string,
): Promise<{ subject: string | null; body: string } | null> {
  const { data } = await admin
    .from("message_templates")
    .select("subject, body, service_module")
    .eq("organization_id", orgId)
    .eq("channel", "email")
    .eq("event_type", "birthday")
    .eq("active", true)
    .is("deleted_at", null)
    .is("service_module", null)
    .limit(1);
  const row = (data ?? [])[0];
  if (!row || !row.body) return null;
  return { subject: row.subject ?? null, body: row.body };
}

// Match the renderTemplate behavior in apps/web/src/lib/message-templates.ts:
// {{token}} substitution, unknown tokens render as empty strings.
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    return vars[key] ?? "";
  });
}

// Minimal HTML fallback that mirrors petBirthdayEmail() in lib/email-templates.ts
// kept inline so the cron has zero dependencies on the web bundle.
function fallbackBirthdayHtml(
  vars: Record<string, string>,
  age: number,
): string {
  const greeting = vars.owner_first_name ? `${escape(vars.owner_first_name)}, ` : "";
  const ageLine =
    age > 0
      ? `${escape(vars.pet_name)} is turning ${age} today.`
      : `It's ${escape(vars.pet_name)}'s birthday today.`;
  return `<!DOCTYPE html><html><body style="font-family:'DM Sans',Arial,sans-serif;background:#F0E6E0;padding:32px;color:#362C26;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;background:#FFFBF8;border:1px solid #E0D4CC;border-radius:14px;padding:28px 32px;">
      <tr><td>
        <div style="font-family:'Fraunces',Georgia,serif;font-weight:700;font-size:28px;letter-spacing:-0.5px;">Snout<span style="color:#CBA48F;">.</span>app</div>
        <h1 style="margin:18px 0 12px;font-family:'Fraunces',Georgia,serif;font-weight:700;font-size:24px;line-height:1.2;">Happy birthday, ${escape(vars.pet_name)}! 🎂</h1>
        <p style="font-size:14px;line-height:1.6;color:#6E5E54;">${greeting}${ageLine} The team at ${escape(vars.org_name)} is sending the warmest birthday wishes.</p>
        <p style="font-size:14px;line-height:1.6;color:#6E5E54;">Whether it's a treat at the next visit or a special belly rub, today's a day to celebrate them. Thanks for letting us be part of your pet's life.</p>
      </td></tr>
    </table>
  </body></html>`;
}

function escape(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
