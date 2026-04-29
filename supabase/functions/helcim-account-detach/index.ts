// Detach the current Helcim account: soft-deletes the helcim_accounts
// row, removes the Vault secret, and falls the org back to the Stripe
// processor so checkouts don't break in the gap before the operator
// reattaches. Idempotent — calling with no live account is a no-op.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const ctx = await requireOrgAdmin(req);
    if (!ctx) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { error: detachErr } = await admin.rpc("detach_helcim_account", {
      _org_id: ctx.orgId,
    });
    if (detachErr) {
      console.error("detach_helcim_account failed:", detachErr);
      return json({ error: "Detach failed", details: detachErr.message }, 500);
    }

    // Fall back to Stripe so the operator's checkout flows still work
    // while they decide what to do next.
    const { error: orgErr } = await admin
      .from("organizations")
      .update({ payment_processor: "stripe" })
      .eq("id", ctx.orgId);
    if (orgErr) {
      console.error("processor fallback to stripe failed:", orgErr);
      // Detach succeeded; this is recoverable from the UI.
    }

    return json({ ok: true, processor: "stripe" });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`helcim-account-detach error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
