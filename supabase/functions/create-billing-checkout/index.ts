// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

// Hardcoded fallback pricing (cents/month per location)
const DEFAULT_PRICES: Record<string, number> = {
  daycare: 4900,
  boarding: 7900,
  grooming: 4900,
  training: 4900,
  retail: 2900,
};

const MODULE_LABELS: Record<string, string> = {
  daycare: "Daycare",
  boarding: "Boarding",
  grooming: "Grooming",
  training: "Training",
  retail: "Retail",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: authErr } = await supabase.auth.getClaims(token);
    if (authErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const moduleSelections: Record<string, boolean> = body.module_selections ?? {};
    const requestedLocationIds: string[] | undefined = body.location_ids;

    // Resolve org from membership
    const { data: mem } = await admin
      .from("memberships")
      .select("organization_id")
      .eq("profile_id", userId)
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!mem?.organization_id) return json({ error: "No organization" }, 404);
    const orgId = mem.organization_id as string;

    const { data: org } = await admin
      .from("organizations")
      .select("id, name, currency, country")
      .eq("id", orgId)
      .single();
    if (!org) return json({ error: "Org not found" }, 404);

    const { data: profile } = await admin
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("id", userId)
      .maybeSingle();

    // Active locations
    let locQuery = admin
      .from("locations")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("active", true)
      .is("deleted_at", null);
    if (requestedLocationIds?.length) locQuery = locQuery.in("id", requestedLocationIds);
    const { data: locations } = await locQuery;
    if (!locations?.length) return json({ error: "No active locations" }, 400);

    const enabledModules = Object.entries(moduleSelections)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!enabledModules.length) return json({ error: "Select at least one module" }, 400);

    // Pricing overrides
    const { data: priceRows } = await admin
      .from("subscription_modules")
      .select("module, location_id, price_cents")
      .eq("organization_id", orgId)
      .is("deleted_at", null);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2024-11-20.acacia",
    });

    // Get or create Stripe customer
    const { data: existingSub } = await admin
      .from("subscriptions")
      .select("id, stripe_customer_id")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    let customerId = existingSub?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile?.email ?? undefined,
        name: org.name,
        metadata: { organization_id: orgId },
      });
      customerId = customer.id;
    }

    const currency = (org.currency as string).toLowerCase();
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    for (const loc of locations) {
      for (const mod of enabledModules) {
        const override = priceRows?.find(
          (r) => r.module === mod && (r.location_id === loc.id || r.location_id === null),
        );
        const price = override?.price_cents && override.price_cents > 0
          ? override.price_cents
          : DEFAULT_PRICES[mod] ?? 4900;
        lineItems.push({
          quantity: 1,
          price_data: {
            currency,
            unit_amount: price,
            recurring: { interval: "month" },
            product_data: {
              name: `Snout ${MODULE_LABELS[mod] ?? mod} — ${loc.name}`,
              metadata: { module: mod, location_id: loc.id, organization_id: orgId },
            },
          },
        });
      }
    }

    const origin = req.headers.get("origin") ?? "https://snout.app";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: lineItems,
      success_url: `${origin}/settings?tab=billing&checkout=success`,
      cancel_url: `${origin}/settings?tab=billing&checkout=cancelled`,
      subscription_data: {
        metadata: { organization_id: orgId },
      },
      metadata: { organization_id: orgId },
    });

    // Upsert subscription row
    if (existingSub?.id) {
      await admin
        .from("subscriptions")
        .update({
          stripe_customer_id: customerId,
          stripe_checkout_session_id: session.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingSub.id);
    } else {
      await admin.from("subscriptions").insert({
        organization_id: orgId,
        stripe_customer_id: customerId,
        stripe_checkout_session_id: session.id,
        status: "trialing",
      });
    }

    return json({ checkout_url: session.url, session_id: session.id });
  } catch (e: any) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`create-billing-checkout error [${errorId}]:`, e);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
