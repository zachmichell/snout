// Multi-touch, multi-channel reservation reminders (Milestone A, Track 1).
//
// Generalizes the original single-window SMS-only reminder into:
//   * multiple touches per reservation (default 7-day + 24-hour, per-org
//     configurable via reminder_settings.offsets_hours), and
//   * multiple channels (SMS via send-sms, email via send-email), chosen
//     per-owner from communication_preference.
//
// Dedup / at-most-once: every (reservation, offset, channel) TOUCH is
// claimed by inserting a row into reminder_log (UNIQUE on those three
// columns). A unique violation means another run already claimed it → skip.
// On a successful send the claim flips to 'sent'; on a send failure the claim
// row is DELETED so the next hourly run retries. This biases toward never
// double-contacting a customer (a missed touch is far less harmful than a
// duplicate) while still retrying genuine failures.
//
// Cadence: an hourly cron (see migration) calls this with an empty body. Each
// run scans, for every configured offset H, the reservations starting in
// [now + H, now + H + LOOKAHEAD]. LOOKAHEAD (90 min) exceeds the hourly
// cadence so consecutive windows overlap and there are no coverage gaps;
// reminder_log makes the overlap safe.
//
// Auth: service-role only. verify_jwt=true validates the signature upstream;
// we then require the service_role claim. (The original used a string compare
// against the SUPABASE_SERVICE_ROLE_KEY env var, which 401'd every cron run:
// the env var differs in representation from the vault service_role_key the
// cron actually posts. Matching the send-staff-push / charge-saved-card
// pattern is robust to that mismatch.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEFAULT_OFFSETS_HOURS = [168, 24]; // 7 days, 24 hours
const DEFAULT_CHANNELS = ["sms", "email"];
const DEFAULT_LOOKAHEAD_MINUTES = 90; // > hourly cadence so windows overlap
const PER_OFFSET_LIMIT = 500; // per (org, offset) safety cap

type Channel = "sms" | "email";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let role: string | undefined;
  try {
    const seg = jwt.split(".")[1] ?? "";
    const padded = seg + "=".repeat((4 - (seg.length % 4)) % 4);
    role = (JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string }).role;
  } catch {
    // malformed JWT → role stays undefined → 401 below
  }
  if (role !== "service_role") return json({ error: "Unauthorized" }, 401);

  try {
  const body = await req.json().catch(() => ({}));
  const overrideOrgId = typeof body?.org_id === "string" ? body.org_id : null;
  const dryRun = body?.dry_run === true;
  const lookaheadMs =
    (typeof body?.lookahead_minutes === "number" ? body.lookahead_minutes : DEFAULT_LOOKAHEAD_MINUTES) *
    60 * 1000;
  const offsetsOverride = sanitizeOffsets(body?.offsets_hours);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();

  let orgsQuery = admin
    .from("organizations")
    .select("id, name")
    .is("deleted_at", null);
  if (overrideOrgId) orgsQuery = orgsQuery.eq("id", overrideOrgId);
  const { data: orgs, error: orgsErr } = await orgsQuery;
  if (orgsErr) return json({ error: orgsErr.message }, 500);

  // Settings per org (default when no row). One query keyed by org id.
  const { data: settingsRows } = await admin
    .from("reminder_settings")
    .select("organization_id, enabled, offsets_hours, channels");
  const settingsByOrg = new Map<string, { enabled: boolean; offsets: number[]; channels: string[] }>();
  for (const s of settingsRows ?? []) {
    settingsByOrg.set(s.organization_id as string, {
      enabled: s.enabled !== false,
      offsets: sanitizeOffsets(s.offsets_hours) ?? DEFAULT_OFFSETS_HOURS,
      channels: Array.isArray(s.channels) && s.channels.length ? (s.channels as string[]) : DEFAULT_CHANNELS,
    });
  }

  let candidates = 0;
  let sent = 0;
  let deduped = 0;
  let skipped = 0;
  let failed = 0;
  const failures: Array<{ reservation_id: string; offset: number; channel: string; reason: string }> = [];

  for (const org of orgs ?? []) {
    const settings = settingsByOrg.get(org.id) ?? {
      enabled: true,
      offsets: DEFAULT_OFFSETS_HOURS,
      channels: DEFAULT_CHANNELS,
    };
    if (!settings.enabled) continue;

    const offsets = offsetsOverride ?? settings.offsets;
    const orgChannels = new Set(settings.channels);

    for (const H of offsets) {
      const windowStart = new Date(now.getTime() + H * 60 * 60 * 1000);
      const windowEnd = new Date(windowStart.getTime() + lookaheadMs);

      const { data: rows, error: cErr } = await admin
        .from("reservations")
        .select(
          `id, start_at, primary_owner_id,
           services:service_id(name),
           owners:primary_owner_id(id, first_name, last_name, phone, email, communication_preference, deleted_at),
           reservation_pets(pets(name))`,
        )
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .in("status", ["confirmed", "requested"])
        .gte("start_at", windowStart.toISOString())
        .lte("start_at", windowEnd.toISOString())
        .limit(PER_OFFSET_LIMIT);
      if (cErr) {
        failures.push({ reservation_id: org.id, offset: H, channel: "-", reason: `query: ${cErr.message}` });
        continue;
      }

      for (const r of rows ?? []) {
        const owner = (r as any).owners;
        if (!owner || owner.deleted_at) {
          skipped += 1;
          continue;
        }

        const pref = owner.communication_preference as string | null;
        const eligible: Channel[] = [];
        if (orgChannels.has("sms") && (pref === "sms" || pref === "both") && owner.phone) eligible.push("sms");
        if (orgChannels.has("email") && (pref === "email" || pref === "both") && owner.email) eligible.push("email");
        if (eligible.length === 0) {
          skipped += 1;
          continue;
        }

        // reservation_pets has a UNIQUE(reservation_id) constraint, so
        // PostgREST embeds it as a single OBJECT, not an array. Normalize
        // to an array so .map() is always safe (same one-to-one gotcha that
        // bit the staff dashboard decode).
        const rpRaw = (r as any).reservation_pets;
        const rpArray = Array.isArray(rpRaw) ? rpRaw : rpRaw ? [rpRaw] : [];
        const petNames = rpArray
          .map((rp: any) => rp.pets?.name)
          .filter((s: any): s is string => !!s);
        const petLabel = petNames.length > 0 ? petNames.join(" & ") : "your pet";
        const serviceName = (r as any).services?.name ?? "service";
        const startDisplay = new Date(r.start_at).toLocaleString("en-CA", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });

        for (const channel of eligible) {
          candidates += 1;

          if (dryRun) {
            sent += 1; // would-send
            continue;
          }

          // Claim the touch. Unique violation = already claimed/sent by a
          // prior (overlapping) run → skip without sending.
          const { data: claim, error: claimErr } = await admin
            .from("reminder_log")
            .insert({
              organization_id: org.id,
              reservation_id: r.id,
              owner_id: owner.id,
              offset_hours: H,
              channel,
              status: "pending",
            })
            .select("id")
            .single();
          if (claimErr) {
            if ((claimErr as { code?: string }).code === "23505") {
              deduped += 1;
            } else {
              failed += 1;
              failures.push({ reservation_id: r.id, offset: H, channel, reason: `claim: ${claimErr.message}` });
            }
            continue;
          }
          const claimId = (claim as { id: string }).id;

          try {
            let sendErr: string | null = null;
            if (channel === "sms") {
              const res = await admin.functions.invoke("send-sms", {
                body: {
                  to: owner.phone,
                  body: `Hi! ${org.name} reminder: ${petLabel}'s ${serviceName} is ${startDisplay}. Reply if you need to reschedule.`,
                  organization_id: org.id,
                  sms_type: "reservation_reminder",
                  reservation_id: r.id,
                  owner_id: owner.id,
                },
              });
              if (res.error) sendErr = res.error.message;
              else if (res.data && (res.data as { success?: boolean }).success === false) {
                sendErr = (res.data as { error?: string }).error ?? "send-sms reported failure";
              }
            } else {
              const res = await admin.functions.invoke("send-email", {
                body: {
                  to: owner.email,
                  subject: `Reminder: ${petLabel}'s ${serviceName}`,
                  html_body: reminderEmailHtml(org.name, petLabel, serviceName, startDisplay),
                  from_name: org.name,
                  organization_id: org.id,
                  email_type: "reservation_reminder",
                },
              });
              if (res.error) sendErr = res.error.message;
              else if (res.data && (res.data as { success?: boolean }).success === false) {
                sendErr = (res.data as { error?: string }).error ?? "send-email reported failure";
              }
            }

            if (sendErr) {
              // Release the claim so the next run retries this touch.
              await admin.from("reminder_log").delete().eq("id", claimId);
              failed += 1;
              failures.push({ reservation_id: r.id, offset: H, channel, reason: sendErr });
            } else {
              await admin
                .from("reminder_log")
                .update({ status: "sent", sent_at: new Date().toISOString() })
                .eq("id", claimId);
              sent += 1;
            }
          } catch (e) {
            await admin.from("reminder_log").delete().eq("id", claimId);
            failed += 1;
            failures.push({ reservation_id: r.id, offset: H, channel, reason: (e as Error).message });
          }
        }
      }
    }
  }

  return json({
    ok: true,
    at: now.toISOString(),
    orgs: orgs?.length ?? 0,
    candidates,
    sent,
    deduped,
    skipped,
    failed,
    failures: failures.slice(0, 25),
  });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`send-reservation-reminders error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

// Keep only positive integer offsets, de-duplicated and sorted descending
// (longest lead first). Returns null for empty/invalid input so callers fall
// back to defaults.
function sanitizeOffsets(input: unknown): number[] | null {
  if (!Array.isArray(input)) return null;
  const cleaned = Array.from(
    new Set(
      input
        .map((n) => (typeof n === "number" ? Math.floor(n) : NaN))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ).sort((a, b) => b - a);
  return cleaned.length ? cleaned : null;
}

function reminderEmailHtml(
  orgName: string,
  petLabel: string,
  serviceName: string,
  startDisplay: string,
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2b2b2b;line-height:1.5;">
  <div style="max-width:520px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 12px;">Appointment reminder</h2>
    <p style="margin:0 0 12px;">Hi! This is a friendly reminder from <strong>${esc(orgName)}</strong>.</p>
    <p style="margin:0 0 12px;"><strong>${esc(petLabel)}</strong>'s <strong>${esc(serviceName)}</strong> is scheduled for <strong>${esc(startDisplay)}</strong>.</p>
    <p style="margin:0 0 12px;">If you need to reschedule, just reply or get in touch with us.</p>
    <p style="margin:16px 0 0;color:#8a8a8a;font-size:13px;">See you soon,<br/>${esc(orgName)}</p>
  </div></body></html>`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
