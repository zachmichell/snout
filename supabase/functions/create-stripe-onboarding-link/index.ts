// Creates (or reuses) a Stripe Standard Connect account for the operator's
// organization and returns a hosted onboarding link.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    // User-scoped client to identify the caller and their org via RLS
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: authErr } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub;
    const userEmail = (claims.claims as any).email as string | undefined;

    const { data: membership, error: memErr } = await userClient
      .from("memberships")
      .select("organization_id, role")
      .eq("profile_id", userId)
      .eq("active", true)
      .maybeSingle();
    if (memErr || !membership) return json({ error: "No active organization" }, 403);
    if (!["owner", "admin"].includes(membership.role)) {
      return json({ error: "Insufficient permissions" }, 403);
    }
    const orgId = membership.organization_id as string;

    const body = await safeJson(req);
    const baseUrl = (body?.base_url as string | undefined) ?? new URL(req.url).origin;
    const returnUrl = `${baseUrl}/settings?tab=payments&stripe_return=success`;
    const refreshUrl = `${baseUrl}/settings?tab=payments&stripe_return=refresh`;

    // Service-role client for writes that bypass RLS (still scoped by orgId in our query)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Reuse existing Connect account if present
    const { data: existing } = await admin
      .from("stripe_connect_accounts")
      .select("id, stripe_account_id, status, charges_enabled, payouts_enabled")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    let stripeAccountId = existing?.stripe_account_id as string | undefined;

    if (!stripeAccountId) {
      const { data: org } = await admin
        .from("organizations")
        .select("name, country, currency")
        .eq("id", orgId)
        .maybeSingle();

      const account = await stripe.accounts.create({
        type: "standard",
        email: userEmail,
        country: (org?.country as string | undefined) ?? undefined,
        metadata: {
          organization_id: orgId,
          created_by: "snout_app",
        },
      });
      stripeAccountId = account.id;

      await admin.from("stripe_connect_accounts").upsert(
        {
          organization_id: orgId,
          stripe_account_id: stripeAccountId,
          account_type: "standard",
          status: "pending",
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
        },
        { onConflict: "organization_id" },
      );
    }

    const link = await stripe.accountLinks.create({
      account: stripeAccountId!,
      type: "account_onboarding",
      return_url: returnUrl,
      refresh_url: refreshUrl,
      collection_options: { fields: "eventually_due" },
    });

    return json({ url: link.url, account_id: stripeAccountId, status: "pending" }, 200);
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`create-stripe-onboarding-link error [${errorId}]:`, err);
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
  try { return await req.json(); } catch { return null; }
}
