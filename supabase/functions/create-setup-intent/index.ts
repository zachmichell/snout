// Creates a Stripe SetupIntent on the operator's connected Standard
// account so the iOS app can collect and save a payment method via
// Stripe's native PaymentSheet (setup mode). Returns the artifacts
// PaymentSheet needs: setupIntentClientSecret, customerId,
// ephemeralKeySecret, and the publishable key for the SDK.
//
// Auth: Bearer token. Caller must be an `owners` row's profile, OR a
// staff member of the same org (so staff can save a card on behalf of
// an owner during an in-person checkout, future use).
//
// Customer model: one Stripe Customer per (org, owner) pair, stored in
// the public.stripe_customers table. Created lazily on first call.
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

    const userId = claims.claims.sub;
    const body = await req.json().catch(() => null);
    const organizationId = body?.organization_id as string | undefined;
    const ownerId = body?.owner_id as string | undefined;
    if (!organizationId || !ownerId) {
      return json({ error: "organization_id and owner_id are required" }, 400);
    }

    // Authorize: the caller must be the owner (their profile matches) OR
    // a staff member of the org. Service role bypasses RLS for the
    // owners + memberships lookup so we don't leak through RLS.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: owner, error: ownerErr } = await admin
      .from("owners")
      .select("id, organization_id, profile_id, email, first_name, last_name")
      .eq("id", ownerId)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (ownerErr || !owner) return json({ error: "Owner not found" }, 404);

    const isOwnerSelf = owner.profile_id === userId;
    let isStaff = false;
    if (!isOwnerSelf) {
      const { data: membership } = await admin
        .from("memberships")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("profile_id", userId)
        .eq("active", true)
        .maybeSingle();
      isStaff = !!membership;
    }
    if (!isOwnerSelf && !isStaff) return json({ error: "Forbidden" }, 403);

    // Resolve the org's connected Stripe account.
    const { data: acct, error: acctErr } = await admin
      .from("stripe_connect_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (acctErr || !acct?.stripe_account_id) {
      return json({ error: "Operator is not set up to accept payments yet." }, 400);
    }
    // We don't require charges_enabled here because SetupIntents work even
    // before charges are enabled — saved cards are useful as soon as the
    // Connect onboarding is complete enough to attach customers.
    const stripeAccount = acct.stripe_account_id as string;

    // Find or create the stripe_customer row.
    let stripeCustomerId: string | null = null;
    const { data: existingRow } = await admin
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("organization_id", organizationId)
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (existingRow?.stripe_customer_id) {
      stripeCustomerId = existingRow.stripe_customer_id;
    } else {
      // Create the Customer on the connected account.
      const customer = await stripe.customers.create(
        {
          email: owner.email ?? undefined,
          name: [owner.first_name, owner.last_name].filter(Boolean).join(" ") || undefined,
          metadata: {
            organization_id: organizationId,
            owner_id: ownerId,
          },
        },
        { stripeAccount },
      );
      stripeCustomerId = customer.id;

      // Persist the mapping. ON CONFLICT guards against a parallel
      // request having created the row in the meantime.
      const { error: insertErr } = await admin
        .from("stripe_customers")
        .upsert(
          {
            organization_id: organizationId,
            owner_id: ownerId,
            stripe_customer_id: stripeCustomerId,
          },
          { onConflict: "organization_id,owner_id" },
        );
      if (insertErr) {
        console.error("create-setup-intent: failed to persist stripe_customer", insertErr);
      }
    }

    // Mint the PaymentSheet artifacts.
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId! },
      { apiVersion: "2024-11-20.acacia", stripeAccount },
    );
    const setupIntent = await stripe.setupIntents.create(
      {
        customer: stripeCustomerId!,
        // Allow the saved method to be used both online (off_session) and
        // in-app — covers Buy Credits, invoice payment, etc.
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: {
          organization_id: organizationId,
          owner_id: ownerId,
        },
      },
      { stripeAccount },
    );

    return json({
      setup_intent_client_secret: setupIntent.client_secret,
      customer_id: stripeCustomerId,
      ephemeral_key_secret: ephemeralKey.secret,
      // The connected account id is required by Stripe SDK on the iOS side
      // so PaymentSheet talks to the right account.
      stripe_account_id: stripeAccount,
      publishable_key: Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? null,
    });
  } catch (err) {
    console.error("create-setup-intent error:", err);
    return json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
