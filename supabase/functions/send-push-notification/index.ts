// Sends a Web Push notification to every active subscription belonging
// to a target profile. Designed to be called from other edge functions
// (the report-card publish notifier, the email senders, etc.) rather
// than directly from the front end — fan-out should always be
// server-side so authorization and templating are centralized.
//
// Authorization: callers present the service-role key in the
// `Authorization: Bearer <key>` header. We do NOT accept user JWTs;
// owners cannot trigger pushes to themselves or anyone else from the
// browser. The verify_jwt flag at deploy time still requires a JWT
// (so the function can't be called anonymously), but the body is
// trusted only when the caller is service-role.
//
// VAPID setup: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT
// must be configured as edge function secrets. Without them the
// function returns 503 immediately rather than silently dropping pushes.
//
// We use the `npm:web-push` library directly. It speaks the VAPID +
// AES-GCM protocol the browser push services require; reimplementing
// it here would be a few hundred lines of HKDF + ECDH + JWT signing
// that the library handles correctly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import webpush from "npm:web-push@3.6.7";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@snout.app";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

type PushPayload = {
  profile_id: string;
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  requireInteraction?: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return json(
        { error: "VAPID keys are not configured for this Snout install" },
        503,
      );
    }

    // Service-role gate: the body's profile_id is trusted only when
    // the caller has presented the service-role key. Anything else
    // (including a normal user JWT) is rejected — owners must not be
    // able to send pushes to other users.
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (token !== SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = (await req.json().catch(() => null)) as Partial<PushPayload> | null;
    if (!body?.profile_id || !body?.title || !body?.body) {
      return json({ error: "profile_id, title, and body are required" }, 400);
    }

    const { data: subs, error: subErr } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("profile_id", body.profile_id)
      .is("deleted_at", null);
    if (subErr) {
      console.error("push_subscriptions read failed:", subErr);
      return json({ error: "Could not load subscriptions" }, 500);
    }

    if (!subs || subs.length === 0) {
      return json({ ok: true, sent: 0, reason: "no subscriptions" });
    }

    const payload = JSON.stringify({
      title: body.title,
      body: body.body,
      url: body.url ?? "/",
      tag: body.tag,
      icon: body.icon,
      badge: body.badge,
      requireInteraction: body.requireInteraction === true,
    });

    let sent = 0;
    let pruned = 0;

    // Settle all sends in parallel; errors per-endpoint are recorded
    // but do not fail the request. 404 / 410 from the push service
    // mean the subscription is dead; soft-delete so we stop trying.
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth },
            },
            payload,
          );
          sent += 1;
        } catch (e) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const status = (e as any)?.statusCode ?? null;
          if (status === 404 || status === 410) {
            await admin
              .from("push_subscriptions")
              .update({ deleted_at: new Date().toISOString() })
              .eq("id", s.id);
            pruned += 1;
          } else {
            console.warn(`push send failed (${status}):`, (e as Error).message);
          }
        }
      }),
    );

    return json({ ok: true, sent, pruned });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`send-push-notification error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
