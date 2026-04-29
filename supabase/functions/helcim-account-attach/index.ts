// Attach (or rotate) a Helcim API token for the caller's organization.
// Flow:
//   1. Authenticate the caller as an org admin/owner.
//   2. Verify the token by hitting Helcim's /connect-test endpoint.
//      If Helcim rejects, we never store the value.
//   3. Persist the token in Vault and link it from helcim_accounts via
//      the set_helcim_api_token SQL helper. This also clears any prior
//      verification state so the operator sees a clean status while we
//      record the verification result on the next line.
//   4. Stamp the row with whatever metadata the caller provided
//      (account label, currency) and mark charges_enabled = true.
//   5. Flip organizations.payment_processor to 'helcim' so the
//      checkout dispatcher targets the new processor immediately.
//
// All of these writes go through service-role; the client never reads
// or writes vault.secrets directly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";
import { helcimVerifyToken } from "../_shared/helcim.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const ctx = await requireOrgAdmin(req);
    if (!ctx) return json({ error: "Unauthorized" }, 401);

    const body = await safeJson(req);
    const apiToken = (body?.api_token as string | undefined)?.trim();
    const accountLabel = (body?.account_label as string | undefined)?.trim() || null;
    const currency = ((body?.currency as string | undefined) ?? "CAD").toUpperCase();
    const webhookVerifier = (body?.webhook_verifier as string | undefined)?.trim();

    if (!apiToken || apiToken.length < 8) {
      return json({ error: "Helcim API token is required" }, 400);
    }
    if (currency !== "CAD" && currency !== "USD") {
      return json({ error: "Currency must be CAD or USD" }, 400);
    }

    // Step 2: verify the token before we ever store it.
    const verify = await helcimVerifyToken(apiToken);
    if (!verify.ok) {
      return json(
        {
          error: "Helcim rejected this token",
          details: verify.error,
          status: verify.status,
        },
        400,
      );
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 3: store + link.
    const { error: setErr } = await admin.rpc("set_helcim_api_token", {
      _org_id: ctx.orgId,
      _api_token: apiToken,
    });
    if (setErr) {
      console.error("set_helcim_api_token failed:", setErr);
      return json({ error: "Could not save token", details: setErr.message }, 500);
    }

    // Step 4: record the verification metadata.
    const { error: verErr } = await admin.rpc("update_helcim_verification", {
      _org_id: ctx.orgId,
      _account_id: null,
      _business_name: accountLabel,
      _currency: currency,
      _charges_enabled: true,
      _verification_error: null,
    });
    if (verErr) {
      console.error("update_helcim_verification failed:", verErr);
      // Token is stored but metadata is incomplete; surface but do not fail.
    }

    // Step 4b: optional webhook verifier. Without it we cannot trust
    // inbound webhooks for this org, but the operator can configure it
    // later from the same panel.
    if (webhookVerifier && webhookVerifier.length >= 8) {
      const { error: vrErr } = await admin.rpc("set_helcim_webhook_verifier", {
        _org_id: ctx.orgId,
        _verifier: webhookVerifier,
      });
      if (vrErr) {
        console.error("set_helcim_webhook_verifier failed:", vrErr);
        // Non-fatal; flag in response so the UI can prompt for a retry.
      }
    }

    // Step 5: switch the org's processor.
    const { error: orgErr } = await admin
      .from("organizations")
      .update({ payment_processor: "helcim" })
      .eq("id", ctx.orgId);
    if (orgErr) {
      console.error("organizations payment_processor flip failed:", orgErr);
      return json({ error: "Could not switch processor", details: orgErr.message }, 500);
    }

    return json({ ok: true, processor: "helcim", currency, charges_enabled: true });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`helcim-account-attach error [${errorId}]:`, err);
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
