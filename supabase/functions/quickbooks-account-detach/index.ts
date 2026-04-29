// Detach a QuickBooks Online connection: revokes the refresh token
// at Intuit's endpoint (best-effort), drops both Vault secrets, and
// soft-deletes the quickbooks_accounts row. Idempotent.
//
// Intuit's revoke endpoint accepts either an access or a refresh
// token. We send the refresh token because revoking it invalidates
// the access token implicitly per Intuit's docs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";
import { revokeToken } from "../_shared/quickbooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTUIT_CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID");
const INTUIT_CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const ctx = await requireOrgAdmin(req);
    if (!ctx) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Best-effort revoke at Intuit. We pull the refresh token first
    // so we have it before the SQL detach drops the vault row.
    let revokeAttempted = false;
    let revokeError: string | null = null;
    if (INTUIT_CLIENT_ID && INTUIT_CLIENT_SECRET) {
      const { data: tokens } = await admin.rpc("get_quickbooks_tokens", {
        _org_id: ctx.orgId,
      });
      const t = Array.isArray(tokens) ? tokens[0] : tokens;
      if (t?.refresh_token) {
        revokeAttempted = true;
        const r = await revokeToken({
          clientId: INTUIT_CLIENT_ID,
          clientSecret: INTUIT_CLIENT_SECRET,
          token: t.refresh_token,
        });
        if (!r.ok) {
          revokeError = r.error;
          console.warn("Intuit revoke failed (continuing with local detach):", r.error);
        }
      }
    }

    const { error: detachErr } = await admin.rpc("detach_quickbooks_account", {
      _org_id: ctx.orgId,
    });
    if (detachErr) {
      console.error("detach_quickbooks_account failed:", detachErr);
      return json({ error: "Detach failed", details: detachErr.message }, 500);
    }

    return json({
      ok: true,
      revoke_attempted: revokeAttempted,
      revoke_error: revokeError,
    });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`quickbooks-account-detach error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
