// Forwards a critical-severity issue report to whatever backend you
// have configured for ops escalation. The destination is a single
// webhook URL in SUPPORT_CRITICAL_WEBHOOK_URL — point it at Slack,
// PagerDuty's events API, Plain.com, or anything else that takes a
// JSON POST. The product is decoupled from the vendor decision.
//
// Captures user, org, browser, current path, and the form fields. The
// caller's identity is verified via the bearer token; nothing the
// front end sends is trusted for user/org attribution.
//
// If the env var is not configured we still record the report in the
// `support_issue_reports` table (added in 3.4) so a later operator
// poll can pick it up, but for the MVP we just respond 503 if the
// destination is missing — better than silently dropping a "critical"
// event.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SUPPORT_CRITICAL_WEBHOOK_URL = Deno.env.get("SUPPORT_CRITICAL_WEBHOOK_URL");

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
    const userId = claims.claims.sub;
    const userEmail = (claims.claims as any).email as string | undefined;

    const body = await req.json().catch(() => null);
    const summary = (body?.summary as string | undefined)?.trim();
    const steps = (body?.steps as string | undefined)?.trim() ?? "";
    const severity = (body?.severity as string | undefined) ?? "critical";
    const path = (body?.current_path as string | undefined) ?? null;
    const userAgent = (body?.user_agent as string | undefined) ?? null;
    if (!summary || summary.length < 10) {
      return json({ error: "Summary must be at least 10 characters" }, 400);
    }
    if (severity !== "critical") {
      return json({ error: "This endpoint is for critical reports only" }, 400);
    }

    // Org attribution: the active membership.
    const { data: membership } = await userClient
      .from("memberships")
      .select("organization_id, role, organizations(name)")
      .eq("profile_id", userId)
      .eq("active", true)
      .maybeSingle();
    const orgId = (membership?.organization_id as string | undefined) ?? null;
    const orgName = (membership as any)?.organizations?.name ?? null;

    if (!SUPPORT_CRITICAL_WEBHOOK_URL) {
      console.error("report-critical-issue: SUPPORT_CRITICAL_WEBHOOK_URL is not set");
      return json(
        { error: "Critical-issue reporting is not configured. Email support directly." },
        503,
      );
    }

    const payload = {
      severity,
      summary,
      steps,
      reporter: { user_id: userId, email: userEmail ?? null },
      organization: { id: orgId, name: orgName },
      context: {
        current_path: path,
        user_agent: userAgent,
        reported_at: new Date().toISOString(),
      },
    };

    const res = await fetch(SUPPORT_CRITICAL_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `report-critical-issue: webhook returned ${res.status}`,
        text.slice(0, 500),
      );
      return json({ error: "Could not deliver report" }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`report-critical-issue error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
