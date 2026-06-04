// send-staff-push
//
// Native APNs push for the Snout Staff iOS app. Reads device_tokens (the
// staff app upserts its APNs token after sign-in) and delivers an alert
// via APNs HTTP/2 with an ES256 JWT minted from a .p8 auth key.
//
// Authorization: service-role only. The DB triggers fan out through
// pg_net.http_post() carrying the service-role token; we reject anything
// else (no user-JWT path) so callers can't push to other staff. The web
// push counterpart is `send-push-notification` (VAPID + push_subscriptions);
// these two intentionally stay separate so the wire formats and key
// material don't get tangled together.
//
// Secrets (set on the Supabase project):
//   APNS_KEY_ID           AuthKey "Key ID" from Apple Developer
//   APNS_TEAM_ID          Apple Developer Team ID (e.g. W55RNZ9Q4Q)
//   APNS_BUNDLE_ID        org.snoutapp.snoutstaff (defaults to that)
//   APNS_PRIVATE_KEY      the .p8 file contents, including BEGIN/END lines
//   APNS_HOST (optional)  https://api.push.apple.com (default; sandbox is
//                         https://api.sandbox.push.apple.com — match the
//                         build's aps-environment entitlement)
//
// JWT caching: APNs accepts a JWT for up to 60 minutes. We reuse one for
// up to 45 minutes per cold start so signing is amortized across requests.
//
// Token pruning: a 410 from APNs means the device token is dead; we
// soft-delete the row (deleted_at = now()) so we stop trying. Other
// non-2xx responses are recorded in the response payload but don't fail
// the request — partial delivery is acceptable.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID");
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID");
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") ?? "org.snoutapp.snoutstaff";
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY");
const APNS_HOST = Deno.env.get("APNS_HOST") ?? "https://api.push.apple.com";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Payload = {
  // Recipient selection (provide one):
  profile_ids?: string[];
  organization_id?: string;
  roles?: string[];               // membership roles to target inside the org
  exclude_profile_id?: string;    // typically the actor — don't notify them

  // Alert content (required):
  title: string;
  body: string;

  // Optional APNs / app fields:
  data?: Record<string, unknown>; // custom keys delivered to the app
  thread_id?: string;             // APNs alert grouping
  category?: string;              // APNs category (for actions)
  badge?: number;
  sound?: string;                 // default = "default"
};

// JWT cache — refreshed every 45 minutes (APNs allows up to 60).
let cachedJwt: { token: string; mintedAt: number } | null = null;

async function mintApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.mintedAt < 45 * 60) {
    return cachedJwt.token;
  }
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) {
    throw new Error("APNs credentials missing");
  }

  const header = { alg: "ES256", kid: APNS_KEY_ID, typ: "JWT" };
  const claims = { iss: APNS_TEAM_ID, iat: now };
  const enc = (obj: object) =>
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  const signingInput = `${enc(header)}.${enc(claims)}`;

  // Import the .p8 (PEM-encoded PKCS#8) as an ECDSA P-256 signing key.
  const pemBody = APNS_PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  const token = `${signingInput}.${base64UrlEncode(sig)}`;
  cachedJwt = { token, mintedAt: now };
  return token;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // Service-role gate. With verify_jwt: true Supabase already verified
    // the JWT signature against the project's JWT secret before this
    // handler runs, so it's safe to decode the payload without re-checking
    // the signature. We just need to confirm the role claim — that's what
    // distinguishes the DB trigger (service_role) from a regular signed-in
    // user (authenticated). Doing this in-handler (vs trusting an env-var
    // string match against SUPABASE_SERVICE_ROLE_KEY) survives service-role
    // key rotations cleanly — the env var and vault can drift, but a
    // freshly-rotated service-role JWT still carries role=service_role.
    const auth = req.headers.get("Authorization") ?? "";
    const callerJwt = auth.replace(/^Bearer\s+/i, "");
    let role: string | undefined;
    try {
      const seg = callerJwt.split(".")[1] ?? "";
      const padded = seg + "=".repeat((4 - (seg.length % 4)) % 4);
      const payload = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
      role = (JSON.parse(payload) as { role?: string }).role;
    } catch {
      // malformed JWT — role stays undefined, request gets rejected below
    }
    if (role !== "service_role") {
      return json({ error: "Forbidden", reason: "service_role required" }, 403);
    }
    if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) {
      return json(
        { error: "APNs credentials are not configured for this Snout install" },
        503,
      );
    }

    const body = (await req.json().catch(() => null)) as Payload | null;
    if (!body || !body.title || !body.body) {
      return json({ error: "title and body are required" }, 400);
    }

    // 1) Resolve target profile_ids.
    let targets: string[] = [];
    if (body.profile_ids?.length) {
      targets = body.profile_ids.filter(Boolean);
    } else if (body.organization_id) {
      let q = admin
        .from("memberships")
        .select("profile_id, role")
        .eq("organization_id", body.organization_id)
        .eq("active", true);
      if (body.roles?.length) q = q.in("role", body.roles);
      const { data: ms, error } = await q;
      if (error) {
        console.error("memberships read failed:", error);
        return json({ error: "Failed to resolve recipients" }, 500);
      }
      targets = (ms ?? []).map((m) => m.profile_id as string).filter(Boolean);
    } else {
      return json(
        { error: "Provide profile_ids or organization_id" },
        400,
      );
    }
    if (body.exclude_profile_id) {
      targets = targets.filter((p) => p !== body.exclude_profile_id);
    }
    // De-dupe.
    targets = Array.from(new Set(targets));
    if (!targets.length) {
      return json({ ok: true, sent: 0, reason: "no recipients" });
    }

    // 2) Look up active staff-app device tokens for those profiles.
    const { data: tokens, error: tokErr } = await admin
      .from("device_tokens")
      .select("id, token, profile_id")
      .in("profile_id", targets)
      .eq("app", "staff")
      .is("deleted_at", null);
    if (tokErr) {
      console.error("device_tokens read failed:", tokErr);
      return json({ error: "Failed to load device tokens" }, 500);
    }
    if (!tokens || tokens.length === 0) {
      return json({ ok: true, sent: 0, reason: "no device tokens" });
    }

    // 3) Mint JWT and build the payload.
    const jwt = await mintApnsJwt();
    const apsAlert = {
      aps: {
        alert: { title: body.title, body: body.body },
        sound: body.sound ?? "default",
        ...(body.badge !== undefined ? { badge: body.badge } : {}),
        ...(body.thread_id ? { "thread-id": body.thread_id } : {}),
        ...(body.category ? { category: body.category } : {}),
      },
      ...(body.data ?? {}),
    };
    const apsBody = JSON.stringify(apsAlert);

    // 4) Fan out. Partial delivery is fine; bad tokens get pruned.
    let sent = 0;
    let pruned = 0;
    const errors: Array<{ token_id: string; status: number; reason?: string }> = [];

    await Promise.all(
      tokens.map(async (t) => {
        try {
          const res = await fetch(`${APNS_HOST}/3/device/${t.token}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${jwt}`,
              "apns-topic": APNS_BUNDLE_ID,
              "apns-push-type": "alert",
              "apns-priority": "10",
              "Content-Type": "application/json",
            },
            body: apsBody,
          });
          if (res.ok) {
            sent += 1;
            return;
          }
          if (res.status === 410) {
            // BadDeviceToken / Unregistered. Stop trying.
            await admin
              .from("device_tokens")
              .update({ deleted_at: new Date().toISOString() })
              .eq("id", t.id);
            pruned += 1;
            return;
          }
          const text = await res.text().catch(() => "");
          errors.push({ token_id: t.id, status: res.status, reason: text });
          console.warn(`APNs ${res.status} for token ${t.id}: ${text}`);
        } catch (e) {
          const reason = (e as Error).message ?? String(e);
          errors.push({ token_id: t.id, status: 0, reason });
          console.error(`APNs network error for token ${t.id}:`, reason);
        }
      }),
    );

    return json({ ok: true, sent, pruned, errors });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`send-staff-push error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
