// Returns the operator-facing view of the current Helcim attachment for
// the caller's org. Pulls from helcim_accounts (no token leak) and the
// processor flag. If a token exists, optionally re-pings Helcim's
// /connect-test endpoint so the UI can surface "Restricted" the moment
// a token is revoked or rotated outside our app.
//
// The re-ping is opt-in (?live=1) because connect-test is cheap but not
// free and most page renders should show cached status.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";
import { helcimVerifyToken } from "../_shared/helcim.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const ctx = await requireOrgAdmin(req);
    if (!ctx) return json({ error: "Unauthorized" }, 401);

    const live =
      new URL(req.url).searchParams.get("live") === "1" ||
      (await safeJson(req))?.live === true;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: org } = await admin
      .from("organizations")
      .select("payment_processor")
      .eq("id", ctx.orgId)
      .maybeSingle();

    const { data: account } = await admin
      .from("helcim_accounts")
      .select(
        "id, account_id, business_name, currency, charges_enabled, status, last_verified_at, last_verification_error, created_at",
      )
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!account) {
      return json({
        processor: org?.payment_processor ?? "stripe",
        account: null,
      });
    }

    if (live) {
      const { data: token } = await admin.rpc("get_helcim_api_token", {
        _org_id: ctx.orgId,
      });
      if (typeof token === "string" && token) {
        const ping = await helcimVerifyToken(token);
        await admin.rpc("update_helcim_verification", {
          _org_id: ctx.orgId,
          _account_id: account.account_id,
          _business_name: account.business_name,
          _currency: account.currency,
          _charges_enabled: ping.ok,
          _verification_error: ping.ok ? null : ping.error,
        });
        // Re-read so we return the freshly stamped row.
        const { data: refreshed } = await admin
          .from("helcim_accounts")
          .select(
            "id, account_id, business_name, currency, charges_enabled, status, last_verified_at, last_verification_error, created_at",
          )
          .eq("organization_id", ctx.orgId)
          .is("deleted_at", null)
          .maybeSingle();
        return json({
          processor: org?.payment_processor ?? "stripe",
          account: refreshed,
        });
      }
    }

    return json({
      processor: org?.payment_processor ?? "stripe",
      account,
    });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`helcim-account-status error [${errorId}]:`, err);
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
