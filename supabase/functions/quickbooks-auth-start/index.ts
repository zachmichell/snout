// Begins the QuickBooks Online OAuth dance. Returns the URL the
// front end redirects the operator to. The state token is persisted
// server-side via create_quickbooks_oauth_pending and consumed when
// the callback function fires.
//
// Auth: org admin/owner. We trust the JWT to identify the
// organization the connection should bind to; the state token then
// carries that binding through Intuit's redirect flow back to us so
// an attacker cannot dangle a connection onto the wrong org.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";
import { buildAuthorizationUrl, generateOAuthState } from "../_shared/quickbooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTUIT_CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID");
const INTUIT_REDIRECT_URI = Deno.env.get("INTUIT_REDIRECT_URI");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!INTUIT_CLIENT_ID || !INTUIT_REDIRECT_URI) {
      return json(
        { error: "QuickBooks integration is not configured for this Snout install" },
        503,
      );
    }

    const ctx = await requireOrgAdmin(req);
    if (!ctx) return json({ error: "Unauthorized" }, 401);

    const body = await safeJson(req);
    const returnTo = (body?.return_to as string | undefined) ?? null;

    const state = generateOAuthState();

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: pendingErr } = await admin.rpc("create_quickbooks_oauth_pending", {
      _state: state,
      _org_id: ctx.orgId,
      _initiated_by: ctx.userId,
      _return_to: returnTo,
    });
    if (pendingErr) {
      console.error("create_quickbooks_oauth_pending failed:", pendingErr);
      return json({ error: "Could not start OAuth", details: pendingErr.message }, 500);
    }

    const authorizationUrl = buildAuthorizationUrl({
      clientId: INTUIT_CLIENT_ID,
      redirectUri: INTUIT_REDIRECT_URI,
      state,
    });

    return json({ url: authorizationUrl, state });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`quickbooks-auth-start error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
