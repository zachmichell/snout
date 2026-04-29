// Stripe Connect webhook — verifies signature, dedupes, marks invoice paid,
// records a payment row. Always returns 200 once signature passes so Stripe
// stops retrying for non-fatal handler errors.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_SIGNING_SECRET_CONNECT = Deno.env.get("STRIPE_SIGNING_SECRET_CONNECT")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 401 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      sig,
      STRIPE_SIGNING_SECRET_CONNECT,
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", (err as Error).message);
    return new Response("Invalid signature", { status: 401 });
  }

  // Dedupe
  const { data: alreadyProcessed } = await admin
    .from("stripe_processed_events")
    .select("id")
    .eq("stripe_event_id", event.id)
    .maybeSingle();
  if (alreadyProcessed) {
    return ok({ received: true, event_id: event.id, processed: false, reason: "duplicate" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session, event.account ?? null);
        break;
      }
      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentSucceeded(intent, event.account ?? null);
        break;
      }
      default:
        console.log(`Unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error(`Handler error for ${event.type}:`, err);
    // Still record + return 200 so Stripe stops retrying
  }

  await admin.from("stripe_processed_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
  });

  return ok({ received: true, event_id: event.id, processed: true });
});

// Cross-check that an inbound payment event really corresponds to the invoice
// whose id is sitting in its metadata. Blocks two classes of attack/bug:
//   (a) an event spoofed onto the wrong org's connected account,
//   (b) a currency mismatch silently credited as if it were invoice currency.
// Returns { ok: true } on pass; otherwise { ok: false, reason } — caller
// should log and skip the state mutation (event is still marked processed).
async function validatePaymentOrigin(
  invoice: { id: string; organization_id: string; currency: string },
  connectedAccountId: string | null,
  paymentCurrency: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!connectedAccountId) {
    return { ok: false, reason: "event has no connected account id" };
  }

  const { data: connect } = await admin
    .from("stripe_connect_accounts")
    .select("stripe_account_id")
    .eq("organization_id", invoice.organization_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!connect?.stripe_account_id) {
    return { ok: false, reason: `org ${invoice.organization_id} has no connect account` };
  }
  if (connect.stripe_account_id !== connectedAccountId) {
    return {
      ok: false,
      reason: `connect account mismatch: event=${connectedAccountId} invoice_org=${connect.stripe_account_id}`,
    };
  }
  if (paymentCurrency && paymentCurrency.toUpperCase() !== invoice.currency.toUpperCase()) {
    return {
      ok: false,
      reason: `currency mismatch: event=${paymentCurrency} invoice=${invoice.currency}`,
    };
  }
  return { ok: true };
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  connectedAccountId: string | null,
) {
  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId) {
    console.warn("checkout.session.completed without invoice_id in metadata");
    return;
  }
  const amountPaid = session.amount_total ?? 0;
  if (amountPaid <= 0) return;

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, total_cents, amount_paid_cents, organization_id, currency")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) {
    console.warn(`Invoice ${invoiceId} not found`);
    return;
  }

  const check = await validatePaymentOrigin(invoice, connectedAccountId, session.currency ?? null);
  if (!check.ok) {
    console.warn(`Rejecting checkout.session.completed for invoice ${invoice.id}: ${check.reason}`);
    return;
  }

  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  if (!paymentIntentId) {
    console.warn(`checkout.session.completed for invoice ${invoice.id} has no payment_intent; skipping`);
    return;
  }

  const enrich = await fetchPaymentEnrichment(paymentIntentId, connectedAccountId);

  const { error: rpcErr } = await admin.rpc("apply_stripe_payment", {
    _invoice_id: invoice.id,
    _payment_intent_id: paymentIntentId,
    _amount_cents: amountPaid,
    _currency: invoice.currency,
    _method: "card",
    _card_funding: enrich.card_funding,
    _expected_payout_at: enrich.expected_payout_at,
  });
  if (rpcErr) {
    console.error(`apply_stripe_payment failed for invoice ${invoice.id}:`, rpcErr);
    return;
  }

  console.log(
    `Invoice ${invoice.id} payment applied; +${amountPaid} (acct ${connectedAccountId ?? "?"}, PI ${paymentIntentId}, funding ${enrich.card_funding ?? "n/a"})`,
  );
}

async function handlePaymentIntentSucceeded(
  intent: Stripe.PaymentIntent,
  connectedAccountId: string | null,
) {
  const invoiceId = intent.metadata?.invoice_id;
  if (!invoiceId) return;

  // If a payments row already exists for this PI, nothing to do (checkout handler ran first)
  const { data: existing } = await admin
    .from("payments")
    .select("id")
    .eq("stripe_payment_intent_id", intent.id)
    .maybeSingle();
  if (existing) return;

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, total_cents, amount_paid_cents, organization_id, currency")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return;

  const check = await validatePaymentOrigin(invoice, connectedAccountId, intent.currency ?? null);
  if (!check.ok) {
    console.warn(`Rejecting payment_intent.succeeded for invoice ${invoice.id}: ${check.reason}`);
    return;
  }

  // Re-use the already-loaded intent if it carries the expanded fields; otherwise refetch.
  const enrich = extractEnrichment(intent) ?? await fetchPaymentEnrichment(intent.id, connectedAccountId);

  const { error: rpcErr } = await admin.rpc("apply_stripe_payment", {
    _invoice_id: invoice.id,
    _payment_intent_id: intent.id,
    _amount_cents: intent.amount_received,
    _currency: invoice.currency,
    _method: "card",
    _card_funding: enrich.card_funding,
    _expected_payout_at: enrich.expected_payout_at,
  });
  if (rpcErr) {
    console.error(`apply_stripe_payment failed for invoice ${invoice.id}:`, rpcErr);
  }
}

// Pull the two fields we care about off a PaymentIntent: card funding type
// (credit, debit, prepaid) and the date Stripe expects the payout to land
// in the connected account. Funding tells us whether a surcharge was legal;
// payout date powers the operator-facing "money lands on..." hint.
//
// We retrieve the PI on the connected account with both branches expanded.
// `payment_method.card.funding` may be null for non-card flows. The payout
// availability date lives on the latest charge's balance transaction. Any
// fetch failure degrades gracefully: the payment still records, just
// without enrichment.
type Enrichment = { card_funding: string | null; expected_payout_at: string | null };

function extractEnrichment(intent: Stripe.PaymentIntent): Enrichment | null {
  const pm = typeof intent.payment_method === "string" ? null : intent.payment_method;
  const charge = typeof intent.latest_charge === "string" ? null : intent.latest_charge;
  if (!pm && !charge) return null;
  const funding = pm?.card?.funding ?? null;
  const balTxn = charge && typeof charge.balance_transaction !== "string"
    ? charge.balance_transaction
    : null;
  const availDate = balTxn?.available_on ?? null;
  return {
    card_funding: funding,
    expected_payout_at: availDate ? new Date(availDate * 1000).toISOString() : null,
  };
}

async function fetchPaymentEnrichment(
  paymentIntentId: string,
  connectedAccountId: string | null,
): Promise<Enrichment> {
  const empty: Enrichment = { card_funding: null, expected_payout_at: null };
  if (!connectedAccountId) return empty;
  try {
    const intent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["payment_method", "latest_charge.balance_transaction"] },
      { stripeAccount: connectedAccountId },
    );
    return extractEnrichment(intent) ?? empty;
  } catch (err) {
    console.warn(`fetchPaymentEnrichment failed for PI ${paymentIntentId}:`, (err as Error).message);
    return empty;
  }
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
