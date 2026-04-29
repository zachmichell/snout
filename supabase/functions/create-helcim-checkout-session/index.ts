// Initializes a HelcimPay.js checkout session for an invoice and returns
// a URL that the operator (or the customer link recipient) opens to pay.
//
// Mirrors create-stripe-checkout-session in shape: same input
// ({ invoice_id, base_url }) and same output ({ checkout_session_id,
// checkout_url }). The checkout_url points at our hosted /pay/helcim
// page rather than a third-party hosted page because HelcimPay.js is a
// JS widget, not a redirect-based flow.
//
// The widget needs both a checkoutToken (passed in the URL) and a
// secretToken (kept server-side; we validate the response hash on the
// next request against it). Both come from Helcim's
// /helcim-pay/initialize endpoint.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { helcimInitializeCheckout } from "../_shared/helcim.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

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

    const { data: invoice, error: invErr } = await userClient
      .from("invoices")
      .select(
        `id, organization_id, owner_id, status, total_cents, amount_paid_cents,
         currency, invoice_number,
         owners:owner_id(email, first_name, last_name)`,
      )
      .eq("id", invoiceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (invErr) {
      console.error("create-helcim-checkout-session invoice lookup error:", invErr);
      return json({ error: "Failed to load invoice" }, 500);
    }
    if (!invoice) return json({ error: "Invoice not found" }, 404);
    if (invoice.status === "paid") return json({ error: "Invoice already paid" }, 409);
    if (invoice.status === "void" || invoice.status === "draft") {
      return json({ error: `Invoice cannot be paid (status: ${invoice.status})` }, 400);
    }

    const balance = (invoice.total_cents ?? 0) - (invoice.amount_paid_cents ?? 0);
    if (balance <= 0) return json({ error: "Nothing to pay" }, 409);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify processor and live account.
    const { data: org } = await admin
      .from("organizations")
      .select("payment_processor")
      .eq("id", invoice.organization_id)
      .maybeSingle();
    if (org?.payment_processor !== "helcim") {
      return json({ error: "Organization is not configured for Helcim payments" }, 400);
    }

    const { data: account } = await admin
      .from("helcim_accounts")
      .select("id, charges_enabled, currency")
      .eq("organization_id", invoice.organization_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!account?.charges_enabled) {
      return json({ error: "Helcim account is not yet able to accept charges" }, 400);
    }

    const invoiceCurrency = (invoice.currency as string).toUpperCase();
    if (invoiceCurrency !== account.currency.toUpperCase()) {
      return json(
        { error: `Invoice currency ${invoiceCurrency} does not match Helcim account ${account.currency}` },
        400,
      );
    }
    if (invoiceCurrency !== "CAD" && invoiceCurrency !== "USD") {
      return json({ error: "Helcim only supports CAD and USD" }, 400);
    }

    const { data: token } = await admin.rpc("get_helcim_api_token", {
      _org_id: invoice.organization_id,
    });
    if (typeof token !== "string" || !token) {
      return json({ error: "Could not resolve Helcim API token" }, 500);
    }

    // Helcim wants amount in major units (not cents) as a number, plus
    // ISO currency. Use the remaining balance so partial payments are
    // applied correctly.
    const amountMajor = Number((balance / 100).toFixed(2));

    const init = await helcimInitializeCheckout(token, {
      paymentType: "purchase",
      amount: amountMajor,
      currency: invoiceCurrency as "CAD" | "USD",
      invoiceNumber: invoice.invoice_number ?? invoice.id.slice(0, 8),
      customerCode: invoice.owner_id ?? undefined,
      customerRequest: "if_required",
    });

    if (!init.ok) {
      console.error("Helcim initialize failed:", init);
      return json({ error: "Helcim could not initialize checkout", details: init.error }, 502);
    }

    const { checkoutToken, secretToken } = init.data;

    // Helcim docs: checkoutToken expires in 60 minutes. Stamp it so the
    // widget UI can refuse stale links instead of erroring at submit.
    const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();

    await admin
      .from("invoices")
      .update({
        helcim_checkout_token: checkoutToken,
        helcim_checkout_secret_token: secretToken,
        helcim_checkout_expires_at: expiresAt,
      })
      .eq("id", invoice.id);

    const checkoutUrl =
      `${baseUrl}/pay/helcim/${invoice.id}?ct=${encodeURIComponent(checkoutToken)}`;

    return json(
      { checkout_session_id: checkoutToken, checkout_url: checkoutUrl, expires_at: expiresAt },
      200,
    );
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`create-helcim-checkout-session error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
