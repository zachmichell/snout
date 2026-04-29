// Fetches live Connect account status from Stripe and syncs it back to the DB.
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
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: authErr } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);

    const { data: membership } = await userClient
      .from("memberships")
      .select("organization_id")
      .eq("profile_id", claims.claims.sub)
      .eq("active", true)
      .maybeSingle();
    if (!membership) return json({ account: null }, 200);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: row } = await admin
      .from("stripe_connect_accounts")
      .select("*")
      .eq("organization_id", membership.organization_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!row) return json({ account: null }, 200);

    // Refresh from Stripe
    let acct;
    try {
      acct = await stripe.accounts.retrieve(row.stripe_account_id);
    } catch (e) {
      console.warn("stripe.accounts.retrieve failed", e);
      return json({ account: row }, 200);
    }

    const charges_enabled = !!acct.charges_enabled;
    const payouts_enabled = !!acct.payouts_enabled;
    const details_submitted = !!acct.details_submitted;
    const status = charges_enabled && payouts_enabled
      ? "active"
      : (acct.requirements?.disabled_reason ? "restricted" : "pending");

    const { data: updated } = await admin
      .from("stripe_connect_accounts")
      .update({ charges_enabled, payouts_enabled, details_submitted, status })
      .eq("id", row.id)
      .select("*")
      .maybeSingle();

    return json({
      account: updated ?? row,
      stripe: {
        email: acct.email ?? null,
        business_name: acct.business_profile?.name ?? null,
        dashboard_url: `https://dashboard.stripe.com/${acct.id}`,
      },
    }, 200);
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`stripe-connect-status error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
