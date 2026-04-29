// Trampoline: takes an `owner_id` from a user-authenticated request,
// resolves the linked profile, and fans a push out by calling
// send-push-notification with service-role.
//
// Authorization model:
//   * Caller must be a member of the same organization that owns the
//     `owners` row (staff publishing report cards, billing flow firing
//     payment receipt, etc.). We enforce this with a service-role
//     lookup against memberships.
//   * Owners themselves are not allowed to push to other owners; the
//     check is "is the caller an org admin/staff with access to this
//     owner?". If you ever want owner-to-owner push (referrals, etc.),
//     extend this gate carefully.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: authErr } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    const ownerId = body?.owner_id as string | undefined;
    const title = (body?.title as string | undefined)?.trim();
    const message = (body?.body as string | undefined)?.trim();
    const url = body?.url as string | undefined;
    const tag = body?.tag as string | undefined;
    const requireInteraction = body?.requireInteraction === true;

    if (!ownerId || !title || !message) {
      return json({ error: "owner_id, title, and body are required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve owner -> organization + profile.
    const { data: owner } = await admin
      .from("owners")
      .select("id, organization_id, profile_id")
      .eq("id", ownerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!owner) return json({ error: "Owner not found" }, 404);
    if (!owner.profile_id) {
      return json({ ok: true, sent: 0, reason: "owner has no linked profile" });
    }

    // Authorization: caller must have an active membership in the
    // owner's org. Done via the user-scoped client so RLS does the
    // gate without us having to re-implement is_org_member here.
    const { data: membership } = await userClient
      .from("memberships")
      .select("id, role")
      .eq("organization_id", owner.organization_id)
      .eq("active", true)
      .maybeSingle();
    if (!membership) {
      return json({ error: "Forbidden" }, 403);
    }

    // Forward to send-push-notification with service role. Calling
    // through fetch directly so we can present the service-role token
    // exactly the way the receiver expects.
    const fnUrl = `${SUPABASE_URL}/functions/v1/send-push-notification`;
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        profile_id: owner.profile_id,
        title,
        body: message,
        url,
        tag,
        requireInteraction,
      }),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      console.error("send-push-notification rejected:", res.status, text);
      return json({ error: "Push delivery failed", details: data }, 502);
    }
    return json({ ok: true, ...((data as object) ?? {}) });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`dispatch-owner-push error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
