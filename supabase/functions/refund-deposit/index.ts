// refund-deposit
//
// Refunds a PAID deposit's Stripe charge and flips the deposit to 'refunded'.
// Completes the deposit money-out path: the Deposits page "Refund" button used
// to only flip a status string (no money returned) — this actually issues the
// refund on the org's connected account.
//
// (Forfeit is intentionally NOT here: forfeiting keeps the money, so it stays
// a plain status flip in the UI.)
//
// At-most-once: claim 'paid' → 'refunding' before calling Stripe (mutual
// exclusion); on success → 'refunded', on Stripe failure → revert to 'paid'.
// A Stripe Idempotency-Key anchored to the deposit id makes the refund itself
// idempotent, so even a race can't double-refund.
//
// Auth: verify_jwt=true; service_role, or manager+ of the deposit's org
// (mirrors stripe-refund-payment — refunds are manager-gated).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "Stripe not configured" }, 503);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    let role: string | undefined;
    let callerSub: string | undefined;
    try {
      const seg = jwt.split(".")[1] ?? "";
      const padded = seg + "=".repeat((4 - (seg.length % 4)) % 4);
      const claims = JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/"))) as {
        role?: string;
        sub?: string;
      };
      role = claims.role;
      callerSub = claims.sub;
    } catch {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => null)) as { deposit_id?: string; reason?: string } | null;
    const depositId = body?.deposit_id;
    if (!depositId) return json({ error: "deposit_id is required" }, 400);

    // Load.
    const { data: deposit, error: depErr } = await admin
      .from("deposits")
      .select("id, organization_id, amount_cents, status, stripe_payment_intent_id, collected_via")
      .eq("id", depositId)
      .maybeSingle();
    if (depErr) throw depErr;
    if (!deposit) return json({ error: "Deposit not found" }, 404);

    // Authorize before revealing status.
    if (role !== "service_role") {
      if (!callerSub) return json({ error: "Unauthorized" }, 401);
      const { data: membership, error: memErr } = await admin
        .from("memberships")
        .select("role")
        .eq("organization_id", deposit.organization_id)
        .eq("profile_id", callerSub)
        .eq("active", true)
        .maybeSingle();
      if (memErr) throw memErr;
      if (!membership || !["owner", "admin", "manager"].includes(membership.role as string)) {
        return json({ error: "Forbidden — manager or above required" }, 403);
      }
    }

    // Only a card-collected, paid deposit can be Stripe-refunded.
    if (deposit.status !== "paid") {
      return json({ ok: false, code: "not_refundable", error: `Deposit is ${deposit.status}, not paid` }, 409);
    }
    if (!deposit.stripe_payment_intent_id) {
      // Paid manually (cash / e-transfer) — no Stripe charge to reverse.
      return json(
        { ok: false, code: "no_stripe_charge", error: "This deposit wasn't collected by card — refund it outside Snout and mark it manually" },
        409,
      );
    }

    // Resolve the connected account.
    const { data: connect } = await admin
      .from("stripe_connect_accounts")
      .select("stripe_account_id")
      .eq("organization_id", deposit.organization_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!connect?.stripe_account_id) {
      return json({ error: "Org has no Stripe Connect account" }, 400);
    }

    // Claim: paid → refunding (mutual exclusion). 0 rows = someone else got it.
    const { data: claimed, error: claimErr } = await admin
      .from("deposits")
      .update({ status: "refunding" })
      .eq("id", deposit.id)
      .eq("status", "paid")
      .select("id");
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) {
      return json({ ok: false, code: "not_refundable", error: "Deposit is no longer refundable" }, 409);
    }

    // Issue the refund (full amount). Idempotency-Key anchored to the deposit
    // so a race / retry can't create a second refund.
    const form = new URLSearchParams();
    form.append("payment_intent", deposit.stripe_payment_intent_id);
    if (body?.reason && ["duplicate", "fraudulent", "requested_by_customer"].includes(body.reason)) {
      form.append("reason", body.reason);
    }

    let stripeRes: Response;
    try {
      stripeRes = await fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Account": connect.stripe_account_id,
          "Idempotency-Key": `refund-deposit:${deposit.id}`,
        },
        body: form.toString(),
      });
    } catch (e) {
      // Network error — outcome unknown. Leave 'refunding' for reconciliation;
      // do NOT revert to paid (reverting could let a landed refund be reissued).
      console.error(`refund-deposit: Stripe request failed for deposit ${deposit.id}:`, (e as Error).message);
      return json({ ok: false, code: "refund_unavailable", error: "Refund request failed — please check Stripe before retrying" }, 502);
    }

    const stripeJson = await stripeRes.json().catch(() => null);
    if (!stripeRes.ok) {
      // Stripe rejected (definite no-charge-moved) → safe to revert to paid.
      const reason = (stripeJson as { error?: { message?: string } } | null)?.error?.message ?? `Stripe ${stripeRes.status}`;
      await admin.from("deposits").update({ status: "paid" }).eq("id", deposit.id).eq("status", "refunding");
      console.warn(`refund-deposit: Stripe refund rejected for deposit ${deposit.id}: ${reason}`);
      return json({ ok: false, code: "refund_rejected", error: reason }, 502);
    }

    // Refund accepted → finalize.
    await admin
      .from("deposits")
      .update({ status: "refunded", refunded_at: new Date().toISOString() })
      .eq("id", deposit.id);

    await admin.from("activity_log").insert({
      organization_id: deposit.organization_id,
      actor_id: role === "service_role" ? null : callerSub,
      action: "refunded",
      entity_type: "deposit",
      entity_id: deposit.id,
      metadata: {
        summary: `Deposit refund issued: ${(deposit.amount_cents ?? 0) / 100}`,
        stripe_refund_id: (stripeJson as { id?: string } | null)?.id ?? null,
        reason: body?.reason ?? null,
      },
    });

    return json({
      ok: true,
      status: "refunded",
      deposit_id: deposit.id,
      refund_id: (stripeJson as { id?: string } | null)?.id ?? null,
      amount_cents: deposit.amount_cents,
    });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`refund-deposit internal error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
