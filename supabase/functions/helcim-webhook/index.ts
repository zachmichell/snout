// Helcim webhook receiver. Stripe and Helcim differ in how they sign
// and route webhooks: Helcim sends a Standard-Webhooks-style HMAC of
// `${timestamp}.${rawBody}` using a per-merchant verifier token that the
// operator pastes into our settings (separate from the API token, which
// is the wrong secret to verify webhooks with).
//
// Routing: Helcim webhooks include the merchant id in the body, but we
// rely on the `helcim-account-id` header (or fallback to the body) to
// pick the org whose verifier we should use. If we cannot resolve a
// matching account or signature, we 401.
//
// Always returns 200 once signature passes so Helcim stops retrying for
// non-fatal handler errors. The processed_events row is inserted at the
// end so duplicates are recognized on retry.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyHelcimWebhookSignature } from "../_shared/helcim.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type HelcimWebhookEnvelope = {
  id?: string;
  type?: string; // "transaction" | "card-batch" | etc.
  data?: {
    transactionId?: string | number;
    type?: string; // "purchase", "refund", etc.
    amount?: number; // major units
    currency?: string;
    invoiceNumber?: string;
    invoiceId?: string;
    cardType?: string;
    cardCategory?: string; // "credit" / "debit" - varies by Helcim payload
    customerCode?: string;
    status?: string; // "APPROVED", "DECLINED", etc.
  };
  // Some Helcim deployments use camelCase top-level keys.
  transactionId?: string | number;
  invoiceId?: string;
};

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("webhook-signature");
  const timestamp = req.headers.get("webhook-timestamp");

  let payload: HelcimWebhookEnvelope;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // Resolve the organization whose verifier we should use. The header
  // is the canonical source; payload fallback is best-effort for older
  // Helcim configurations that did not set the header.
  const accountIdHeader = req.headers.get("helcim-account-id");
  const orgId = await resolveOrgForAccount(accountIdHeader);
  if (!orgId) {
    console.warn("helcim-webhook: could not resolve org from account header", accountIdHeader);
    return new Response("Unknown account", { status: 401 });
  }

  const { data: verifier } = await admin.rpc("get_helcim_webhook_verifier", {
    _org_id: orgId,
  });
  if (typeof verifier !== "string" || !verifier) {
    console.warn("helcim-webhook: no verifier configured for org", orgId);
    return new Response("Verifier not configured", { status: 401 });
  }

  const valid = await verifyHelcimWebhookSignature(rawBody, signature, timestamp, verifier);
  if (!valid) {
    console.warn("helcim-webhook: signature verification failed for org", orgId);
    return new Response("Invalid signature", { status: 401 });
  }

  // Dedupe before any work. Helcim retries on non-2xx, and even on a
  // 200 a network blip can re-fire the same event.
  const eventId =
    payload.id ??
    String(payload.data?.transactionId ?? payload.transactionId ?? "") ??
    crypto.randomUUID();
  if (eventId) {
    const { data: alreadyProcessed } = await admin
      .from("helcim_processed_events")
      .select("id")
      .eq("helcim_event_id", eventId)
      .maybeSingle();
    if (alreadyProcessed) {
      return ok({ received: true, event_id: eventId, processed: false, reason: "duplicate" });
    }
  }

  try {
    const data = payload.data ?? {};
    const status = (data.status ?? "").toUpperCase();
    const txnId = String(data.transactionId ?? payload.transactionId ?? "");

    if (status === "APPROVED" && txnId) {
      await reconcileApprovedPurchase(orgId, payload, txnId);
    } else {
      console.log(
        `helcim-webhook: skipping non-approved or missing-txn event (status=${status})`,
      );
    }
  } catch (err) {
    console.error("helcim-webhook handler error:", err);
    // Still record + return 200 so Helcim stops retrying.
  }

  await admin.from("helcim_processed_events").insert({
    helcim_event_id: eventId,
    event_type: payload.type ?? "transaction",
    organization_id: orgId,
  });

  return ok({ received: true, event_id: eventId, processed: true });
});

// Map a Helcim account id (the merchant's account number, populated on
// the helcim_accounts.account_id column once we know it) to our org.
// In the early-attach state we will not yet have account_id stamped, so
// we also fall back to the singleton "this org has a helcim account"
// lookup when only one Helcim org exists for that account-id-less case.
async function resolveOrgForAccount(accountId: string | null): Promise<string | null> {
  if (accountId) {
    const { data } = await admin
      .from("helcim_accounts")
      .select("organization_id")
      .eq("account_id", accountId)
      .is("deleted_at", null)
      .maybeSingle();
    if (data?.organization_id) return data.organization_id as string;
  }
  // Fallback: resolve unambiguously when we have exactly one un-stamped
  // Helcim account in the system. This covers the operator's first
  // webhook before account_id is recorded.
  const { data: stamped } = await admin
    .from("helcim_accounts")
    .select("organization_id")
    .is("account_id", null)
    .is("deleted_at", null);
  if (stamped && stamped.length === 1) return stamped[0].organization_id as string;
  return null;
}

async function reconcileApprovedPurchase(
  orgId: string,
  payload: HelcimWebhookEnvelope,
  txnId: string,
) {
  const data = payload.data ?? {};
  const invoiceNumber = data.invoiceNumber ?? null;
  if (!invoiceNumber) {
    console.warn(`helcim-webhook: txn ${txnId} has no invoiceNumber; cannot reconcile`);
    return;
  }

  // Look up the invoice. Helcim's invoiceNumber maps to
  // invoices.invoice_number when set; we also accept the row's id slice
  // (first 8 chars) as fallback, mirroring how create-helcim-checkout
  // populates the field.
  const { data: invoice } = await admin
    .from("invoices")
    .select("id, total_cents, amount_paid_cents, organization_id, currency, invoice_number")
    .eq("organization_id", orgId)
    .or(`invoice_number.eq.${invoiceNumber},id.like.${invoiceNumber}%`)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!invoice) {
    console.warn(`helcim-webhook: invoice ${invoiceNumber} not found for org ${orgId}`);
    return;
  }

  const amountCents = Math.round(Number(data.amount ?? 0) * 100);
  if (amountCents <= 0) return;

  const cardFunding =
    typeof data.cardCategory === "string" && data.cardCategory.toLowerCase() === "debit"
      ? "debit"
      : typeof data.cardCategory === "string" && data.cardCategory.toLowerCase() === "credit"
        ? "credit"
        : null;

  const { error } = await admin.rpc("apply_helcim_payment", {
    _invoice_id: invoice.id,
    _helcim_transaction_id: txnId,
    _amount_cents: amountCents,
    _currency: invoice.currency,
    _method: "card",
    _card_funding: cardFunding,
    _helcim_invoice_number: invoiceNumber,
  });

  if (error) {
    console.error(`apply_helcim_payment failed for invoice ${invoice.id}:`, error);
    return;
  }
  console.log(
    `helcim-webhook: applied ${amountCents}c to invoice ${invoice.id} (txn ${txnId})`,
  );
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
