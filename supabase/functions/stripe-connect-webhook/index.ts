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
      case "setup_intent.succeeded": {
        const setupIntent = event.data.object as Stripe.SetupIntent;
        await handleSetupIntentSucceeded(setupIntent, event.account ?? null);
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
  // Two flavors of checkout fund this app:
  //   - Invoice payments (metadata.invoice_id) → mark invoice paid + record payment.
  //   - Credit-package purchases (metadata.package_id) → grant credits to the
  //     owner and create an owner_subscriptions row, idempotently keyed by
  //     session.id.
  // Sessions without either id in metadata are unhandled (pre-existing
  // direct charges, marketing test transactions, etc).
  const packageId = session.metadata?.package_id;
  if (packageId) {
    await handlePackagePurchaseCompleted(session, connectedAccountId);
    return;
  }

  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId) {
    console.warn("checkout.session.completed without invoice_id or package_id in metadata");
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

// Apply a successful credit-package purchase. Idempotent via the unique
// partial index on `owner_subscriptions.stripe_checkout_session_id`: a
// re-delivered Stripe event yields a duplicate-key error which we treat as
// "already applied" and silently skip.
//
// Credit-key convention (the keys we expect inside subscription_packages.
// included_credits): `daycare_full_day`, `daycare_half_day`, `boarding_night`,
// `store_credit_cents`. Anything else is preserved on owner_subscriptions
// .remaining_credits so staff retain visibility, but isn't denormalized to
// owners' fast-access columns.
async function handlePackagePurchaseCompleted(
  session: Stripe.Checkout.Session,
  connectedAccountId: string | null,
) {
  const packageId = session.metadata?.package_id as string | undefined;
  const ownerId = session.metadata?.owner_id as string | undefined;
  const organizationId = session.metadata?.organization_id as string | undefined;
  if (!packageId || !ownerId || !organizationId) {
    console.warn(
      `Package purchase missing metadata; got package_id=${packageId} owner_id=${ownerId} org=${organizationId}`,
    );
    return;
  }

  const amountPaid = session.amount_total ?? 0;
  if (amountPaid <= 0) {
    console.warn(`Package purchase session ${session.id} has zero amount; skipping`);
    return;
  }

  // Connect-account match: the operator's stripe_account_id must equal the
  // event's connected account so we don't fulfill against the wrong org.
  if (connectedAccountId) {
    const { data: connect } = await admin
      .from("stripe_connect_accounts")
      .select("stripe_account_id")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (connect?.stripe_account_id !== connectedAccountId) {
      console.warn(
        `Package purchase connect mismatch: event=${connectedAccountId} org=${connect?.stripe_account_id}`,
      );
      return;
    }
  }

  // Load the package so we know what credits to grant. We use service-role
  // here because the webhook isn't acting as a user.
  const { data: pkg, error: pkgErr } = await admin
    .from("subscription_packages")
    .select("id, included_credits, validity_days, billing_cycle")
    .eq("id", packageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (pkgErr || !pkg) {
    console.warn(`Package ${packageId} not found for purchase fulfillment`);
    return;
  }

  const credits = (pkg.included_credits ?? {}) as Record<string, number>;

  // next_billing_date for one-time packages is null; for recurring (monthly /
  // quarterly / annual) we set to now + cycle. validity_days, when set,
  // additionally caps when un-used credits expire (handled by expire-credits).
  const nextBilling = nextBillingDateFromCycle(pkg.billing_cycle);

  // Insert owner_subscriptions with idempotency via stripe_checkout_session_id.
  const { error: subErr } = await admin
    .from("owner_subscriptions")
    .insert({
      organization_id: organizationId,
      owner_id: ownerId,
      package_id: packageId,
      remaining_credits: credits,
      status: "active",
      next_billing_date: nextBilling,
      stripe_checkout_session_id: session.id,
    });
  if (subErr) {
    // Duplicate-key error means we've already processed this session — fine.
    if ((subErr as { code?: string }).code === "23505") {
      console.log(`Package purchase ${session.id} already applied; idempotent skip`);
      return;
    }
    console.error(`owner_subscriptions insert failed for session ${session.id}:`, subErr);
    return;
  }

  // Denormalize the well-known keys onto owners.* so the home credits card
  // doesn't have to aggregate across all owner_subscriptions on every render.
  const incFull   = Number(credits.daycare_full_day ?? 0) | 0;
  const incHalf   = Number(credits.daycare_half_day ?? 0) | 0;
  const incNights = Number(credits.boarding_night ?? 0) | 0;
  const incStoreCents = Number(credits.store_credit_cents ?? 0) | 0;

  if (incFull || incHalf || incNights || incStoreCents) {
    const { data: ownerRow, error: ownErr } = await admin
      .from("owners")
      .select("daycare_full_day_credits, daycare_half_day_credits, boarding_night_credits, store_credit_cents")
      .eq("id", ownerId)
      .maybeSingle();
    if (ownErr || !ownerRow) {
      console.error(`owner ${ownerId} not found for credit denormalization`);
      return;
    }
    const updated = {
      daycare_full_day_credits: (ownerRow.daycare_full_day_credits ?? 0) + incFull,
      daycare_half_day_credits: (ownerRow.daycare_half_day_credits ?? 0) + incHalf,
      boarding_night_credits:   (ownerRow.boarding_night_credits ?? 0) + incNights,
      store_credit_cents:       (ownerRow.store_credit_cents ?? 0) + incStoreCents,
    };
    const { error: updErr } = await admin
      .from("owners")
      .update(updated)
      .eq("id", ownerId);
    if (updErr) {
      console.error(`owner credit increment failed for ${ownerId}:`, updErr);
    }
  }

  console.log(
    `Package purchase fulfilled: owner=${ownerId} package=${packageId} session=${session.id} credits=${JSON.stringify(credits)}`,
  );
}

function nextBillingDateFromCycle(cycle: string | null | undefined): string | null {
  if (!cycle || cycle === "one_time") return null;
  const now = new Date();
  switch (cycle) {
    case "monthly":   now.setMonth(now.getMonth() + 1); break;
    case "quarterly": now.setMonth(now.getMonth() + 3); break;
    case "annual":    now.setFullYear(now.getFullYear() + 1); break;
    default:          return null;
  }
  return now.toISOString();
}

async function handlePaymentIntentSucceeded(
  intent: Stripe.PaymentIntent,
  connectedAccountId: string | null,
) {
  // Package purchases are fulfilled by handlePackagePurchaseCompleted via
  // checkout.session.completed (which also fires payment_intent.succeeded
  // for the same charge). Skip here so we don't try to treat a package
  // purchase as an invoice payment.
  if (intent.metadata?.package_id) return;

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

// ───────────────────────────────────────────────────────────────────────
// setup_intent.succeeded — pet parent saved a card via the iOS Add Card
// flow. Insert the payment method into our local table so it appears in
// the Payment Methods list and can be charged in future flows.
// ───────────────────────────────────────────────────────────────────────
async function handleSetupIntentSucceeded(
  setupIntent: Stripe.SetupIntent,
  connectedAccountId: string | null,
) {
  if (!connectedAccountId) {
    console.warn("setup_intent.succeeded without connectedAccountId, skipping");
    return;
  }

  const stripeCustomerId = typeof setupIntent.customer === "string"
    ? setupIntent.customer
    : setupIntent.customer?.id ?? null;
  const stripePaymentMethodId = typeof setupIntent.payment_method === "string"
    ? setupIntent.payment_method
    : setupIntent.payment_method?.id ?? null;

  if (!stripeCustomerId || !stripePaymentMethodId) {
    console.warn("setup_intent.succeeded missing customer or payment_method, skipping", {
      id: setupIntent.id,
      stripeCustomerId,
      stripePaymentMethodId,
    });
    return;
  }

  // Resolve (org, owner) from the stripe_customers mapping. The setup
  // intent metadata also has these, but trusting the local table is
  // safer in case metadata was lost or swapped.
  const { data: mapping, error: mappingErr } = await admin
    .from("stripe_customers")
    .select("organization_id, owner_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  if (mappingErr || !mapping) {
    console.warn("setup_intent.succeeded: no stripe_customers row for", stripeCustomerId, mappingErr);
    return;
  }

  // Retrieve the PaymentMethod on the connected account so we can store
  // brand + last4 + expiry. The SetupIntent event payload doesn't include
  // expanded card details, so a follow-up fetch is required.
  let card: Stripe.PaymentMethod.Card | null = null;
  try {
    const pm = await stripe.paymentMethods.retrieve(
      stripePaymentMethodId,
      { stripeAccount: connectedAccountId },
    );
    card = pm.card ?? null;
  } catch (err) {
    console.warn("setup_intent.succeeded: failed to retrieve PM", stripePaymentMethodId, (err as Error).message);
  }
  // If we couldn't pull card details, skip the insert — payment_methods
  // has CHECK constraints on expiry_month/year that would reject zeroes,
  // and a row with no brand/last4 isn't useful to render anyway. Stripe
  // will retry the webhook on transient retrieve failures.
  if (!card || !card.brand || !card.last4 || !card.exp_month || !card.exp_year) {
    console.warn("setup_intent.succeeded: card details unavailable, skipping insert", stripePaymentMethodId);
    return;
  }

  // Determine if this should be the default — first card on file gets it.
  const { count } = await admin
    .from("payment_methods")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", mapping.organization_id)
    .eq("owner_id", mapping.owner_id);
  const isFirst = (count ?? 0) === 0;

  // Idempotent insert keyed on stripe_payment_method_id so retried events
  // (or duplicate setup_intents for the same PM) don't double-insert.
  const { error: insertErr } = await admin
    .from("payment_methods")
    .upsert(
      {
        organization_id: mapping.organization_id,
        owner_id: mapping.owner_id,
        card_brand: card.brand,
        card_last_four: card.last4,
        expiry_month: card.exp_month,
        expiry_year: card.exp_year,
        is_default: isFirst,
        stripe_payment_method_id: stripePaymentMethodId,
      },
      { onConflict: "stripe_payment_method_id" },
    );
  if (insertErr) {
    console.error("setup_intent.succeeded: failed to upsert payment_method", insertErr);
  }
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
