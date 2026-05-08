// Reliability Batch B: daily reservation-reminder cron.
//
// Iterates active orgs, finds reservations starting in the next 24-48
// hour window, and sends a reminder SMS to each owner who's opted in
// to SMS (communication_preference = 'sms' or 'both') and has a phone
// on file. Dedupes via sms_log: a reservation that already has a
// 'reservation_reminder' row in sms_log within the last 48 hours is
// skipped.
//
// Why a 24-48 window vs exactly "24 hours out": cron fires once a
// day at the same wall-clock time, so a reservation booked just
// before the cron run might be 23h59m away when we check. Treating
// the window as [24h, 48h] gives a one-day-out reminder for every
// reservation regardless of the cron-firing-vs-booking-time race.
// Repeated runs are deduped by the sms_log lookup.
//
// Auth: service-role only. Cron sets the Authorization header
// explicitly via the wrapper RPC; the function itself rejects all
// other callers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 24h-48h window in milliseconds.
const WINDOW_START_MS = 24 * 60 * 60 * 1000;
const WINDOW_END_MS = 48 * 60 * 60 * 1000;
// Dedup window — if we've already sent a reminder for this reservation
// in the last 48h, don't send another. The window is wide enough to
// absorb cron retries and any one-time backfill.
const DEDUP_WINDOW_MS = 48 * 60 * 60 * 1000;

// Per-org cap so a misconfigured org with thousands of upcoming bookings
// can't melt the function's 60s budget.
const PER_ORG_LIMIT = 200;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token !== SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const overrideOrgId = typeof body?.org_id === "string" ? body.org_id : null;
  const dryRun = body?.dry_run === true;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const now = new Date();
  const windowStart = new Date(now.getTime() + WINDOW_START_MS);
  const windowEnd = new Date(now.getTime() + WINDOW_END_MS);
  const dedupSince = new Date(now.getTime() - DEDUP_WINDOW_MS).toISOString();

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
  const failures: Array<{ reservation_id: string; reason: string }> = [];

  for (const org of orgs ?? []) {
    // Pull confirmed and checked-in reservations starting in the window,
    // joined to the primary owner so we can check communication_preference
    // and phone in one query. service for the body.
    const { data: candidates, error: cErr } = await admin
      .from("reservations")
      .select(
        `id, start_at, location_id, primary_owner_id,
         services:service_id(name, module),
         owners:primary_owner_id(id, first_name, last_name, phone, communication_preference, deleted_at),
         reservation_pets(pets(name))`,
      )
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .in("status", ["confirmed", "requested"])
      .gte("start_at", windowStart.toISOString())
      .lte("start_at", windowEnd.toISOString())
      .limit(PER_ORG_LIMIT);
    if (cErr) {
      failures.push({ reservation_id: org.id, reason: `org list: ${cErr.message}` });
      continue;
    }

    for (const r of candidates ?? []) {
      try {
        totalCandidates += 1;
        const owner = (r as any).owners;
        if (!owner || owner.deleted_at) {
          totalSkipped += 1;
          continue;
        }
        if (
          !(owner.communication_preference === "sms" || owner.communication_preference === "both")
        ) {
          totalSkipped += 1;
          continue;
        }
        if (!owner.phone) {
          totalSkipped += 1;
          continue;
        }

        // Dedup: any sms_log row for this reservation in the last 48h?
        const { data: existing } = await admin
          .from("sms_log")
          .select("id")
          .eq("organization_id", org.id)
          .eq("sms_type", "reservation_reminder")
          .eq("reservation_id", r.id)
          .gte("sent_at", dedupSince)
          .limit(1);
        if (existing && existing.length > 0) {
          totalSkipped += 1;
          continue;
        }

        const petNames = ((r as any).reservation_pets ?? [])
          .map((rp: any) => rp.pets?.name)
          .filter((s: any): s is string => !!s);
        const petLabel = petNames.length > 0 ? petNames.join(" & ") : "your pet";
        const serviceName = (r as any).services?.name ?? "service";
        const startDate = new Date(r.start_at);
        const startDisplay = startDate.toLocaleString("en-CA", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });

        const messageBody = `Hi! ${org.name} reminder: ${petLabel}'s ${serviceName} is ${startDisplay}. Reply if you need to reschedule.`;

        if (dryRun) {
          totalSent += 1;
          continue;
        }

        const sendRes = await admin.functions.invoke("send-sms", {
          body: {
            to: owner.phone,
            body: messageBody,
            organization_id: org.id,
            sms_type: "reservation_reminder",
            reservation_id: r.id,
            owner_id: owner.id,
          },
        });
        if (sendRes.error) {
          totalFailed += 1;
          failures.push({ reservation_id: r.id, reason: sendRes.error.message });
        } else {
          totalSent += 1;
        }
      } catch (e) {
        totalFailed += 1;
        failures.push({ reservation_id: (r as any).id, reason: (e as Error).message });
      }
    }
  }

  return json({
    ok: true,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    orgs: orgs?.length ?? 0,
    candidates: totalCandidates,
    sent: totalSent,
    skipped: totalSkipped,
    failed: totalFailed,
    failures: failures.slice(0, 25),
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
