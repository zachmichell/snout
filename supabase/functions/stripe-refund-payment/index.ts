// Click-count fix for Flow 5: refund a payment from inside Snout instead
// of routing the operator to the Stripe Dashboard.
//
// Takes a Snout payment_id, looks up the linked Stripe payment intent,
// posts a refund to the org's Stripe Connect account, and updates the
// payments row to status='refunded'. The QBO sync (6.4b — already
// shipped) sees the status change on its next tick and posts a
// RefundReceipt to QuickBooks downstream — we don't have to touch that
// path here.
//
// Auth: org admin / payments role. The user's JWT scopes the read of
// the payments row through RLS; the actual Stripe call uses the org's
// connected account.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

interface Payload {
  payment_id: string;
  reason?: "duplicate" | "fraudulent" | "requested_by_customer" | null;
  amount_cents?: number; // optional for partial refunds; defaults to full
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!STRIPE_SECRET_KEY) {
    return json({ error: "Stripe not configured" }, 503);
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!payload.payment_id) return json({ error: "Missing payment_id" }, 400);

  // Fetch the payment via the user's JWT so RLS gates org access.
  const { data: payment, error: pErr } = await userClient
    .from("payments")
    .select(
      "id, organization_id, amount_cents, currency, method, status, stripe_payment_intent_id, invoice_id",
    )
    .eq("id", payload.payment_id)
    .maybeSingle();
  if (pErr) return json({ error: pErr.message }, 500);
  if (!payment) return json({ error: "Payment not found" }, 404);

  if (payment.status !== "succeeded") {
    return json(
      {
        error: `Payment status is '${payment.status}'; only succeeded payments can be refunded`,
      },
      400,
    );
  }
  if (payment.method !== "card" && payment.method !== "ach") {
    return json(
      {
        error: `Method '${payment.method}' refunds aren't issued through Stripe — record the refund manually`,
      },
      400,
    );
  }
  if (!payment.stripe_payment_intent_id) {
    return json({ error: "Payment has no Stripe intent attached" }, 400);
  }

  // Admin role check — front-desk staff PINs shouldn't be able to refund.
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: membership } = await userClient
    .from("memberships")
    .select("role")
    .eq("profile_id", user.id)
    .eq("organization_id", payment.organization_id)
    .eq("active", true)
    .maybeSingle();
  if (
    !membership ||
    !["owner", "admin", "manager"].includes(membership.role as string)
  ) {
    return json({ error: "Forbidden — manager or above required to refund" }, 403);
  }

  // Resolve the org's Stripe Connect account so we can post the refund
  // on the platform's behalf to the merchant's connected account.
  const { data: connect } = await admin
    .from("stripe_connect_accounts")
    .select("stripe_account_id, status")
    .eq("organization_id", payment.organization_id)
    .maybeSingle();
  if (!connect?.stripe_account_id) {
    return json({ error: "Org has no Stripe Connect account" }, 400);
  }

  // POST the refund. Stripe accepts amount_cents for partial; omit for full.
  const form = new URLSearchParams();
  form.append("payment_intent", payment.stripe_payment_intent_id);
  if (payload.amount_cents && payload.amount_cents > 0) {
    if (payload.amount_cents > payment.amount_cents) {
      return json({ error: "Refund amount exceeds the original payment" }, 400);
    }
    form.append("amount", String(payload.amount_cents));
  }
  if (payload.reason) form.append("reason", payload.reason);

  let stripeRes: Response;
  try {
    stripeRes = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Tell Stripe to act on the connected account.
        "Stripe-Account": connect.stripe_account_id,
      },
      body: form.toString(),
    });
  } catch (e) {
    return json({ error: `Stripe request failed: ${(e as Error).message}` }, 502);
  }
  let stripeJson: any = null;
  try {
    stripeJson = await stripeRes.json();
  } catch {
    /* leave null; we'll fall through to the !ok branch */
  }
  if (!stripeRes.ok) {
    const reason = stripeJson?.error?.message ?? `Stripe ${stripeRes.status}`;
    return json({ error: reason }, 502);
  }

  // Stripe accepted the refund. Flip the payments row immediately so the
  // operator's UI reflects the change without waiting for the webhook.
  // The webhook will arrive shortly and is idempotent.
  const isPartial =
    payload.amount_cents && payload.amount_cents < payment.amount_cents;
  const newStatus = isPartial ? "partially_refunded" : "refunded";

  await admin
    .from("payments")
    .update({
      status: newStatus,
      refunded_at: new Date().toISOString(),
      refund_amount_cents: payload.amount_cents ?? payment.amount_cents,
    })
    .eq("id", payment.id);

  // Activity log row so the audit trail picks it up.
  await admin.from("activity_log").insert({
    organization_id: payment.organization_id,
    actor_id: user.id,
    action: "refunded",
    entity_type: "payment",
    entity_id: payment.id,
    metadata: {
      summary: `Refund issued: ${(payload.amount_cents ?? payment.amount_cents) / 100} ${payment.currency}`,
      stripe_refund_id: stripeJson?.id ?? null,
      reason: payload.reason ?? null,
      partial: !!isPartial,
    },
  });

  return json({
    success: true,
    refund_id: stripeJson?.id ?? null,
    amount_cents: payload.amount_cents ?? payment.amount_cents,
    new_status: newStatus,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
