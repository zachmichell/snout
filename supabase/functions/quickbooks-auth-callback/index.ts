// OAuth callback target. Intuit redirects the user here after
// authorization; we exchange the code for tokens, store them in
// Vault, fetch company info to populate the display name, and
// redirect back to Snout's settings page.
//
// No JWT auth: this endpoint receives a top-level browser redirect
// from Intuit, not an authenticated XHR. CSRF protection is the state
// token, which we issued in quickbooks-auth-start and stored bound to
// the org. consume_quickbooks_oauth_pending verifies the state is
// valid, not expired, and not previously consumed.
//
// On success, redirect to <return_to>?qbo_return=success.
// On any failure, redirect to <return_to>?qbo_return=error&reason=...
// We never return raw 4xx/5xx HTML to the browser; the user sees the
// settings page either way and the operator can interpret the toast.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  exchangeAuthorizationCode,
  fetchCompanyInfo,
  type QboEnvironment,
} from "../_shared/quickbooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTUIT_CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID");
const INTUIT_CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET");
const INTUIT_REDIRECT_URI = Deno.env.get("INTUIT_REDIRECT_URI");
const INTUIT_ENVIRONMENT = (Deno.env.get("INTUIT_ENVIRONMENT") ??
  "sandbox") as QboEnvironment;
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.snout.app";

const DEFAULT_RETURN = "/settings?tab=quickbooks";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");
  const errorParam = url.searchParams.get("error");

  if (
    !INTUIT_CLIENT_ID || !INTUIT_CLIENT_SECRET || !INTUIT_REDIRECT_URI
  ) {
    return redirect(`${APP_BASE_URL}${DEFAULT_RETURN}&qbo_return=error&reason=not_configured`);
  }

  // The user denied authorization on Intuit's screen.
  if (errorParam) {
    return redirect(
      `${APP_BASE_URL}${DEFAULT_RETURN}&qbo_return=error&reason=${encodeURIComponent(errorParam)}`,
    );
  }

  if (!code || !state || !realmId) {
    return redirect(`${APP_BASE_URL}${DEFAULT_RETURN}&qbo_return=error&reason=missing_params`);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Consume the state token. consume_quickbooks_oauth_pending returns
  // exactly one row when the state is valid and not expired, and zero
  // rows otherwise (also handling the case where the state was already
  // consumed by a prior callback).
  const { data: consumed, error: consumeErr } = await admin.rpc(
    "consume_quickbooks_oauth_pending",
    { _state: state },
  );
  if (consumeErr) {
    console.error("consume_quickbooks_oauth_pending error:", consumeErr);
    return redirect(`${APP_BASE_URL}${DEFAULT_RETURN}&qbo_return=error&reason=state_lookup_failed`);
  }
  const pending = Array.isArray(consumed) ? consumed[0] : consumed;
  if (!pending?.organization_id) {
    return redirect(`${APP_BASE_URL}${DEFAULT_RETURN}&qbo_return=error&reason=invalid_state`);
  }

  const orgId = pending.organization_id as string;
  const returnTo = (pending.return_to as string | null) ?? DEFAULT_RETURN;

  // Exchange the authorization code for tokens. Failures here mean
  // Intuit rejected our credentials or the code was already used; the
  // operator's only recovery is to retry the connect flow.
  const tokens = await exchangeAuthorizationCode({
    clientId: INTUIT_CLIENT_ID,
    clientSecret: INTUIT_CLIENT_SECRET,
    code,
    redirectUri: INTUIT_REDIRECT_URI,
  });
  if (!tokens.ok) {
    console.error("exchangeAuthorizationCode failed:", tokens.error);
    return redirect(
      `${APP_BASE_URL}${returnTo}&qbo_return=error&reason=${encodeURIComponent("token_exchange_failed")}`,
    );
  }

  // Fetch company info so the settings UI can render a meaningful
  // name. Failure here is non-fatal; we still persist the tokens with
  // a placeholder name and let a later live-check populate the field.
  let companyName: string | null = null;
  const company = await fetchCompanyInfo({
    accessToken: tokens.data.access_token,
    realmId,
    environment: INTUIT_ENVIRONMENT,
  });
  if (company.ok) {
    companyName = company.data.CompanyName ?? company.data.LegalName ?? null;
  } else {
    console.warn("fetchCompanyInfo failed (non-fatal):", company.error);
  }

  const accessExpiresAt = new Date(
    Date.now() + tokens.data.expires_in * 1000,
  ).toISOString();

  const { error: setErr } = await admin.rpc("set_quickbooks_tokens", {
    _org_id: orgId,
    _realm_id: realmId,
    _company_name: companyName,
    _environment: INTUIT_ENVIRONMENT,
    _access_token: tokens.data.access_token,
    _refresh_token: tokens.data.refresh_token,
    _access_expires_at: accessExpiresAt,
  });
  if (setErr) {
    console.error("set_quickbooks_tokens failed:", setErr);
    return redirect(
      `${APP_BASE_URL}${returnTo}&qbo_return=error&reason=${encodeURIComponent("storage_failed")}`,
    );
  }

  // 6.4.5a: Prime the per-org tax-code cache immediately after a
  // successful connect. Fire-and-forget: failures are surfaced in the
  // Failed Syncs panel and via the manual "Refresh tax codes" button;
  // the connect flow itself doesn't block on it.
  primeTaxCodeCache(orgId).catch((err) =>
    console.warn("primeTaxCodeCache failed (non-fatal):", err),
  );

  return redirect(`${APP_BASE_URL}${returnTo}&qbo_return=success`);
});

async function primeTaxCodeCache(orgId: string): Promise<void> {
  const url = `${SUPABASE_URL}/functions/v1/quickbooks-refresh-tax-codes`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ org_id: orgId }),
  });
}

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location } });
}
