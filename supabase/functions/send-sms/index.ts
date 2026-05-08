// Reliability Batch B: send transactional SMS via Twilio.
//
// Mirrors send-email's contract closely so the surrounding code (helper
// in lib/sms.ts, the reservation-reminder cron, the manual "send now"
// path) reads symmetric to the email pipeline. Every send writes one
// row to sms_log with the Twilio message SID, status, and any error.
//
// Phone-number policy: callers pass any reasonable input (E.164,
// (555) 555-1234, 5555551234, etc.); we normalize to E.164 at the
// boundary. Numbers that don't normalize cleanly are rejected with a
// clear error rather than blindly forwarded to Twilio.
//
// Provider: a single Snout-side Twilio account. Operator BYO Twilio
// (per-org account SID + auth) is a future batch.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  to: string;                       // any reasonable input; we normalize
  body: string;                     // the SMS text body (already rendered)
  organization_id: string;
  sms_type?: string;                // 'reservation_reminder', 'waiver_reminder', etc.
  reservation_id?: string;
  owner_id?: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER");

const MAX_BODY_LENGTH = 1600; // Twilio's hard cap; we reject above this

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return json({ success: false, error: "Twilio not configured" }, 503);
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  const normalized = normalizeE164(body.to);
  if (!normalized) {
    return json({ success: false, error: "Invalid recipient phone number" }, 400);
  }
  if (!body.body || typeof body.body !== "string") {
    return json({ success: false, error: "Invalid 'body'" }, 400);
  }
  if (body.body.length > MAX_BODY_LENGTH) {
    return json(
      { success: false, error: `Body exceeds ${MAX_BODY_LENGTH} characters` },
      400,
    );
  }
  if (!body.organization_id || typeof body.organization_id !== "string") {
    return json({ success: false, error: "Invalid 'organization_id'" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Send via Twilio. The Messages endpoint is a POST with form-encoded body.
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const form = new URLSearchParams();
  form.append("To", normalized);
  form.append("From", TWILIO_FROM_NUMBER);
  form.append("Body", body.body);

  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  let twilioRes: Response;
  try {
    twilioRes = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch (e) {
    const reason = (e as Error).message ?? String(e);
    await logToSmsTable(admin, body, normalized, "failed", reason, null);
    return json({ success: false, error: `Twilio request failed: ${reason}` }, 502);
  }

  let twilioJson: any = null;
  try {
    twilioJson = await twilioRes.json();
  } catch {
    /* leave null; we'll log raw status */
  }

  if (!twilioRes.ok) {
    const reason =
      twilioJson?.message ?? twilioJson?.code ?? `Twilio ${twilioRes.status}`;
    await logToSmsTable(admin, body, normalized, "failed", reason, null);
    return json({ success: false, error: reason }, 502);
  }

  const sid: string | null = typeof twilioJson?.sid === "string" ? twilioJson.sid : null;
  // Twilio returns 'queued' or 'sent' on initial accept; the final
  // 'delivered' state arrives via webhook (a future batch). We log the
  // initial state and let the webhook (if/when wired) update it.
  const initialStatus: string = typeof twilioJson?.status === "string" ? twilioJson.status : "queued";

  await logToSmsTable(admin, body, normalized, initialStatus, null, sid);

  return json({ success: true, sid, status: initialStatus });
});

async function logToSmsTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  payload: Payload,
  recipient: string,
  status: string,
  error_message: string | null,
  message_sid: string | null,
) {
  try {
    await admin.from("sms_log").insert({
      organization_id: payload.organization_id,
      recipient_phone: recipient,
      sms_type: payload.sms_type ?? null,
      body: payload.body,
      status,
      error_message,
      message_sid,
      reservation_id: payload.reservation_id ?? null,
      owner_id: payload.owner_id ?? null,
    });
  } catch {
    /* swallow log errors so they don't mask the original send result */
  }
}

// Normalize a free-form phone string to E.164. Rules of thumb:
//   - Strip every character except digits and a leading "+".
//   - If it starts with "+" and the rest is 10..15 digits, accept.
//   - If it's 10 digits, prepend "+1" (NANP default — fine for CA / US).
//   - If it's 11 digits starting with "1", prepend "+".
//   - Anything else is rejected.
//
// The 10-digit NANP default is the right call for our Western Canadian
// primary market; international numbers must be entered with a leading
// "+" and country code already.
function normalizeE164(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (hasPlus) {
    if (digits.length < 10 || digits.length > 15) return null;
    return `+${digits}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
