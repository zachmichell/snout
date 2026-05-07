// 6.6a: Pull Stripe payouts for each connected account and stage them
// in processor_payouts + payment_payouts so the QBO sync function can
// post Bank Deposits.
//
// Flow per org:
//   1. Read stripe_connect_accounts.stripe_account_id.
//   2. List Stripe payouts created since the latest payout_date in
//      processor_payouts (or the past 30 days on first run).
//   3. For each new payout:
//      - Insert processor_payouts row (gross/fee/net + payout date).
//      - List balance_transactions for that payout to get per-charge
//        fees and link Snout payments via stripe_payment_intent_id.
//      - Insert payment_payouts junction rows.
//   4. processor_payouts.state defaults to 'ready' so the next
//      quickbooks-sync-payouts run picks them up.
//
// Triggered:
//   - Manually via UI button (operator authenticates as admin).
//   - On a daily cron tick (service-role bearer).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const QBO_CRON_SECRET = Deno.env.get("QBO_CRON_SECRET");

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Auth: user JWT (admin) or service-role bearer.
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const isServiceRole =
    (!!SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) ||
    (!!QBO_CRON_SECRET && token === QBO_CRON_SECRET);

  let orgIdFilter: string | null = null;
  if (isServiceRole) {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.org_id === "string") orgIdFilter = body.org_id;
  } else {
    const ctx = await requireOrgAdmin(req);
    if (!ctx) return json({ error: "Unauthorized" }, 401);
    orgIdFilter = ctx.orgId;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Pull Stripe Connect accounts for the orgs we'll ingest.
  let accountQuery = admin
    .from("stripe_connect_accounts")
    .select("organization_id, stripe_account_id, payouts_enabled")
    .is("deleted_at", null)
    .eq("payouts_enabled", true);
  if (orgIdFilter) accountQuery = accountQuery.eq("organization_id", orgIdFilter);
  const { data: accounts, error: acctsErr } = await accountQuery;
  if (acctsErr) {
    return json({ error: "Could not list Stripe Connect accounts", details: acctsErr.message }, 500);
  }
  if (!accounts || accounts.length === 0) {
    return json({ ok: true, orgs: 0, payouts_inserted: 0 });
  }

  let payoutsInserted = 0;
  const orgFailures: Array<{ org_id: string; reason: string }> = [];

  for (const acct of accounts as Array<{
    organization_id: string;
    stripe_account_id: string;
    payouts_enabled: boolean;
  }>) {
    try {
      // Determine the watermark — the most recent payout_date we've
      // already ingested for this org. On first run, default to 30
      // days back so we don't miss anything but don't rip a year of
      // history either.
      const { data: latest } = await admin
        .from("processor_payouts")
        .select("payout_date")
        .eq("organization_id", acct.organization_id)
        .eq("processor", "stripe")
        .order("payout_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const sinceDate = latest?.payout_date
        ? new Date(latest.payout_date)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const sinceUnix = Math.floor(sinceDate.getTime() / 1000);

      // List payouts. Stripe paginates with starting_after; loop until
      // we've consumed everything since the watermark.
      let startingAfter: string | undefined = undefined;
      const newPayouts: Stripe.Payout[] = [];
      while (true) {
        const page: Stripe.ApiList<Stripe.Payout> = await stripe.payouts.list(
          {
            limit: 100,
            arrival_date: { gte: sinceUnix },
            status: "paid",
            ...(startingAfter ? { starting_after: startingAfter } : {}),
          },
          { stripeAccount: acct.stripe_account_id },
        );
        newPayouts.push(...page.data);
        if (!page.has_more || page.data.length === 0) break;
        startingAfter = page.data[page.data.length - 1].id;
      }

      for (const po of newPayouts) {
        // Skip if already ingested.
        const { data: existing } = await admin
          .from("processor_payouts")
          .select("id")
          .eq("organization_id", acct.organization_id)
          .eq("processor", "stripe")
          .eq("processor_payout_id", po.id)
          .maybeSingle();
        if (existing) continue;

        // Stripe.Payout exposes `amount` (net after fees) and a
        // single `fee` value rolled up. To get per-charge fees we
        // pull the balance_transactions for this payout. The sum of
        // their `gross` (= amount + fee) is the gross deposit amount.
        const transactions: Stripe.BalanceTransaction[] = [];
        let txStartingAfter: string | undefined = undefined;
        while (true) {
          const txPage = await stripe.balanceTransactions.list(
            {
              payout: po.id,
              limit: 100,
              ...(txStartingAfter ? { starting_after: txStartingAfter } : {}),
            },
            { stripeAccount: acct.stripe_account_id },
          );
          transactions.push(...txPage.data);
          if (!txPage.has_more || txPage.data.length === 0) break;
          txStartingAfter = txPage.data[txPage.data.length - 1].id;
        }

        // Aggregate. We only count "charge" + "payment" types as
        // gross; "stripe_fee" is reported separately. payouts.fee
        // already gives the net figure but we recompute defensively.
        let grossCents = 0;
        let feeCents = 0;
        const chargeTxns: Array<{
          tx: Stripe.BalanceTransaction;
          chargeId: string;
          fee: number;
        }> = [];
        for (const tx of transactions) {
          if (tx.type === "charge" || tx.type === "payment") {
            grossCents += tx.amount;
            feeCents += tx.fee;
            const chargeId =
              typeof tx.source === "string" ? tx.source : tx.source?.id ?? "";
            chargeTxns.push({ tx, chargeId, fee: tx.fee });
          } else if (tx.type === "stripe_fee" || tx.type === "fee_refund") {
            feeCents += tx.amount * -1; // stripe_fee is reported negative
          }
          // Other types (refund, payout, etc.) intentionally skipped.
        }
        // Net should match Stripe's reported payout amount, give or
        // take a rounding cent.
        const netCents = grossCents - feeCents;

        const { data: inserted, error: insErr } = await admin
          .from("processor_payouts")
          .insert({
            organization_id: acct.organization_id,
            processor: "stripe",
            processor_payout_id: po.id,
            gross_cents: grossCents,
            fee_cents: feeCents,
            net_cents: netCents,
            payout_date: new Date(po.arrival_date * 1000)
              .toISOString()
              .slice(0, 10),
            currency: po.currency.toUpperCase() === "USD" ? "USD" : "CAD",
            description: po.description ?? null,
            state: "ready",
          })
          .select("id")
          .single();
        if (insErr || !inserted) continue;
        payoutsInserted += 1;

        // Link Snout payments to this payout via stripe_payment_intent_id.
        // Each charge has a payment_intent; we stored those on
        // payments.stripe_payment_intent_id at charge time. Resolve
        // chargeId -> payment_intent_id once per charge then look up
        // the matching Snout payment.
        const chargeIdToPiId = new Map<string, string>();
        for (const c of chargeTxns) {
          if (!c.chargeId) continue;
          try {
            const charge = await stripe.charges.retrieve(c.chargeId, {}, {
              stripeAccount: acct.stripe_account_id,
            });
            const piId =
              typeof charge.payment_intent === "string"
                ? charge.payment_intent
                : charge.payment_intent?.id;
            if (piId) chargeIdToPiId.set(c.chargeId, piId);
          } catch {
            // Charge fetch failed — skip this link.
          }
        }
        const piIds = Array.from(new Set(chargeIdToPiId.values()));
        const paymentByPi = new Map<string, string>();
        if (piIds.length > 0) {
          const { data: paymentRows } = await admin
            .from("payments")
            .select("id, stripe_payment_intent_id")
            .eq("organization_id", acct.organization_id)
            .in("stripe_payment_intent_id", piIds);
          for (const r of paymentRows ?? [])
            paymentByPi.set(r.stripe_payment_intent_id ?? "", r.id);
        }
        for (const c of chargeTxns) {
          const piId = chargeIdToPiId.get(c.chargeId);
          if (!piId) continue;
          const paymentId = paymentByPi.get(piId);
          if (!paymentId) continue;
          await admin
            .from("payment_payouts")
            .insert({
              organization_id: acct.organization_id,
              payment_id: paymentId,
              payout_id: inserted.id,
              fee_cents: c.fee,
            })
            .select("id")
            .maybeSingle();
        }
      }
    } catch (e) {
      orgFailures.push({
        org_id: acct.organization_id,
        reason: (e as Error).message,
      });
    }
  }

  return json({
    ok: true,
    orgs: accounts.length,
    payouts_inserted: payoutsInserted,
    failures: orgFailures.slice(0, 10),
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
