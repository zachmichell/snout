// Creates a Stripe Checkout Session for a credit package purchase. Mirrors
// the structure of create-stripe-checkout-session (invoice version) but for
// rows in `subscription_packages` and stores `package_id` in metadata so the
// connect webhook can apply credits to the buyer on payment success.
//
// The flow:
//   1. iOS app POSTs `{ package_id, base_url? }` with the user's bearer token.
//   2. We resolve the buyer's owner_id by joining auth.uid() → owners.profile_id
//      against the package's organization_id (so we charge the right facility).
//   3. We look up the operator's connected Stripe account.
//   4. We create a payment-mode Checkout Session DIRECT on the connected
//      account, with line_items = the package and metadata = { package_id,
//      owner_id, organization_id } so the webhook knows what to apply.
//   5. We return the checkout_url for the iOS app to open in SFSafariView.

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
    const profileId = (claims.claims.sub as string).toLowerCase();

    const body = await req.json().catch(() => null);
    const packageId = body?.package_id as string | undefined;
    const baseUrl = (body?.base_url as string | undefined) ?? new URL(req.url).origin;
    if (!packageId) return json({ error: "package_id required" }, 400);

    // Read package with RLS — the customer is a member of the org via their
    // membership row, so the "Org members read packages" policy lets the
    // SELECT through. Service-role for write paths only.
    const { data: pkg, error: pkgErr } = await userClient
      .from("subscription_packages")
      .select("id, organization_id, name, description, price_cents, included_credits, billing_cycle, active")
      .eq("id", packageId)
      .is("deleted_at", null)
      .maybeSingle();
    if (pkgErr) {
      console.error("create-package-checkout-session pkg lookup error:", pkgErr);
      return json({ error: "Failed to load package" }, 500);
    }
    if (!pkg) return json({ error: "Package not found" }, 404);
    if (!pkg.active) return json({ error: "Package is not available for purchase" }, 400);
    if ((pkg.price_cents ?? 0) <= 0) {
      return json({ error: "Package has no price set" }, 400);
    }

    // Look up the buyer's owner row in this org.
    const { data: owner, error: ownErr } = await userClient
      .from("owners")
      .select("id, email, first_name, last_name")
      .eq("profile_id", profileId)
      .eq("organization_id", pkg.organization_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (ownErr) {
      console.error("create-package-checkout-session owner lookup error:", ownErr);
      return json({ error: "Failed to load owner" }, 500);
    }
    if (!owner) return json({ error: "Owner record not found in this facility" }, 404);

    // Operator's connected account (service-role: parent doesn't have direct
    // RLS to read the connect table).
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: acct } = await admin
      .from("stripe_connect_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("organization_id", pkg.organization_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!acct?.stripe_account_id || !acct.charges_enabled) {
      return json({ error: "Facility is not set up to accept payments yet." }, 400);
    }

    const ownerEmail = owner.email ?? undefined;
    // Currency: org default. Could be a column on organizations; fall back to CAD.
    const { data: org } = await admin
      .from("organizations")
      .select("currency")
      .eq("id", pkg.organization_id)
      .maybeSingle();
    const currency = ((org?.currency as string | undefined) ?? "cad").toLowerCase();

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: pkg.price_cents,
              product_data: {
                name: pkg.name,
                description: pkg.description ?? undefined,
              },
            },
          },
        ],
        customer_email: ownerEmail,
        success_url: `${baseUrl}/portal-owner/credits?package=success`,
        cancel_url: `${baseUrl}/portal-owner/credits?package=cancelled`,
        metadata: {
          package_id: pkg.id,
          organization_id: pkg.organization_id,
          owner_id: owner.id,
        },
        payment_intent_data: {
          metadata: {
            package_id: pkg.id,
            organization_id: pkg.organization_id,
            owner_id: owner.id,
          },
        },
      },
      { stripeAccount: acct.stripe_account_id },
    );

    return json({
      checkout_session_id: session.id,
      checkout_url: session.url,
    }, 200);
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`create-package-checkout-session error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
