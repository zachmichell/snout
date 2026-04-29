// Creates a Stripe Checkout Session as a DIRECT charge on the operator's
// connected Standard account (Stripe-Account header). One line item using
// the invoice total to avoid rounding mismatch with stored taxes.
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

    const body = await req.json().catch(() => null);
    const invoiceId = body?.invoice_id as string | undefined;
    const baseUrl = (body?.base_url as string | undefined) ?? new URL(req.url).origin;
    if (!invoiceId) return json({ error: "invoice_id required" }, 400);

    // userClient queries are RLS-bound — both staff (org membership) and owner
    // (matching owner record) can read their invoices.
    const { data: invoice, error: invErr } = await userClient
      .from("invoices")
      .select(
        `id, organization_id, owner_id, status, total_cents, amount_paid_cents,
         currency, invoice_number, stripe_checkout_session_id,
         owners:owner_id(email, first_name, last_name)`,
      )
      .eq("id", invoiceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (invErr) {
      console.error("create-stripe-checkout-session invoice lookup error:", invErr);
      return json({ error: "Failed to load invoice" }, 500);
    }
    if (!invoice) return json({ error: "Invoice not found" }, 404);
    if (invoice.status === "paid") {
      return json({ error: "Invoice already paid" }, 409);
    }
    if (invoice.status === "void" || invoice.status === "draft") {
      return json({ error: `Invoice cannot be paid (status: ${invoice.status})` }, 400);
    }

    const balance = (invoice.total_cents ?? 0) - (invoice.amount_paid_cents ?? 0);
    if (balance <= 0) return json({ error: "Nothing to pay" }, 409);

    // Look up the operator's Connect account using service role
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: acct } = await admin
      .from("stripe_connect_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("organization_id", invoice.organization_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!acct?.stripe_account_id || !acct.charges_enabled) {
      return json({ error: "Operator is not set up to accept payments yet." }, 400);
    }

    const owner = (invoice as any).owners;
    const ownerEmail = owner?.email ?? undefined;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: (invoice.currency as string).toLowerCase(),
              unit_amount: balance,
              product_data: {
                name: `Invoice ${invoice.invoice_number ?? invoice.id.slice(0, 8)}`,
                description: owner
                  ? `For ${owner.first_name ?? ""} ${owner.last_name ?? ""}`.trim()
                  : undefined,
              },
            },
          },
        ],
        customer_email: ownerEmail,
        success_url: `${baseUrl}/portal/invoices/${invoice.id}?payment=success`,
        cancel_url: `${baseUrl}/portal/invoices/${invoice.id}?payment=cancelled`,
        metadata: {
          invoice_id: invoice.id,
          organization_id: invoice.organization_id,
          owner_id: invoice.owner_id ?? "",
        },
        payment_intent_data: {
          metadata: {
            invoice_id: invoice.id,
            organization_id: invoice.organization_id,
          },
        },
      },
      { stripeAccount: acct.stripe_account_id }, // DIRECT charge on connected account
    );

    // Save session id on the invoice (service role to bypass owner RLS UPDATE rules)
    await admin
      .from("invoices")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", invoice.id);

    return json({ checkout_session_id: session.id, checkout_url: session.url }, 200);
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`create-stripe-checkout-session error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
