// Returns the operator-facing view of the current QuickBooks
// connection. Pulls from quickbooks_accounts (no token leak). With
// ?live=1, also re-pings Intuit's /companyinfo endpoint to verify
// the stored access token is still valid; refreshes via the stored
// refresh token if it is not. Surfacing live re-verification through
// this function keeps the refresh-on-401 logic out of every later
// caller in the QBO sync stack.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";
import {
  fetchCompanyInfo,
  refreshAccessToken,
  type QboEnvironment,
} from "../_shared/quickbooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTUIT_CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID");
const INTUIT_CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET");

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

    const account = await loadAccount(admin, ctx.orgId);
    if (!account) {
      return json({ account: null });
    }

    if (!live) {
      return json({ account });
    }

    if (!INTUIT_CLIENT_ID || !INTUIT_CLIENT_SECRET) {
      return json({ account, live_check: { ok: false, reason: "not_configured" } });
    }

    // Live verification path. Steps:
    //   1. Pull current tokens from Vault.
    //   2. If access token is past its half-life, refresh first.
    //   3. Hit /companyinfo to verify the (possibly fresh) access token.
    //   4. Stamp last_verified_at and update company_name if changed.
    const tokens = await getTokens(admin, ctx.orgId);
    if (!tokens) {
      return json({ account, live_check: { ok: false, reason: "no_tokens" } });
    }

    let accessToken = tokens.access_token;
    let refreshToken = tokens.refresh_token;
    const expiresAt = tokens.access_token_expires_at
      ? new Date(tokens.access_token_expires_at).getTime()
      : 0;

    // Refresh proactively if we're within 2 minutes of expiry.
    if (Date.now() > expiresAt - 2 * 60 * 1000) {
      const refreshed = await refreshAccessToken({
        clientId: INTUIT_CLIENT_ID,
        clientSecret: INTUIT_CLIENT_SECRET,
        refreshToken,
      });
      if (!refreshed.ok) {
        await admin
          .from("quickbooks_accounts")
          .update({
            status: "restricted",
            last_verification_error: refreshed.error,
          })
          .eq("organization_id", ctx.orgId);
        return json({
          account,
          live_check: { ok: false, reason: "refresh_failed", error: refreshed.error },
        });
      }
      accessToken = refreshed.data.access_token;
      refreshToken = refreshed.data.refresh_token;
      const newExpiresAt = new Date(
        Date.now() + refreshed.data.expires_in * 1000,
      ).toISOString();
      await admin.rpc("update_quickbooks_tokens", {
        _org_id: ctx.orgId,
        _access_token: accessToken,
        _refresh_token: refreshToken,
        _access_expires_at: newExpiresAt,
      });
    }

    const ping = await fetchCompanyInfo({
      accessToken,
      realmId: tokens.realm_id,
      environment: tokens.environment as QboEnvironment,
    });

    if (!ping.ok) {
      await admin
        .from("quickbooks_accounts")
        .update({
          status: "restricted",
          last_verification_error: ping.error,
        })
        .eq("organization_id", ctx.orgId);
      return json({
        account: await loadAccount(admin, ctx.orgId),
        live_check: { ok: false, reason: "verify_failed", error: ping.error },
      });
    }

    await admin
      .from("quickbooks_accounts")
      .update({
        status: "active",
        last_verified_at: new Date().toISOString(),
        last_verification_error: null,
        company_name: ping.data.CompanyName ?? account.company_name,
      })
      .eq("organization_id", ctx.orgId);

    return json({
      account: await loadAccount(admin, ctx.orgId),
      live_check: { ok: true, company_name: ping.data.CompanyName ?? null },
    });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`quickbooks-account-status error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

async function loadAccount(admin: ReturnType<typeof createClient>, orgId: string) {
  const { data } = await admin
    .from("quickbooks_accounts")
    .select(
      "id, realm_id, company_name, environment, status, last_verified_at, last_verification_error, access_token_expires_at, created_at",
    )
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  return data ?? null;
}

async function getTokens(admin: ReturnType<typeof createClient>, orgId: string) {
  const { data, error } = await admin.rpc("get_quickbooks_tokens", { _org_id: orgId });
  if (error) {
    console.error("get_quickbooks_tokens error:", error);
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0] as {
    access_token: string;
    refresh_token: string;
    realm_id: string;
    environment: string;
    access_token_expires_at: string | null;
  };
}

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
