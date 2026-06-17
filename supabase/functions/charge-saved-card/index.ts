// charge-saved-card
//
// Off-session charge primitive: charges a saved card on the org's Stripe
// Connect (Standard) account, on behalf of an owner who previously saved a
// payment method via `create-setup-intent`. This is the keystone that
// unlocks deposit collection, no-show / late-cancel fees, and bulk overdue
// collection — every "take money from a card we already have" path routes
// through here so the Stripe call, idempotency, and decline handling live
// in exactly one place.
//
// Scope: this is a PRIMITIVE. It moves money and returns a structured
// result. It deliberately does NOT write `deposits` / `payments` / domain
// rows — the calling feature (deposit flow, no-show flow, bulk collection)
// owns its own audit row and records the returned payment_intent_id against
// it. That keeps this function reusable and keeps each domain's
// reconciliation logic where it belongs.
//
// Charge model mirrors the rest of Snout: a DIRECT charge on the connected
// account ({ stripeAccount }), no application fee, no on_behalf_of — same as
// create-stripe-checkout-session / create-setup-intent.
//
// Auth (verify_jwt = true, so Supabase validates the JWT signature upstream):
//   - role=service_role  → trusted caller (DB triggers / crons / bulk jobs)
//   - otherwise           → must be an active owner/admin/manager of the org
//     (money-out is manager-gated, mirroring stripe-refund-payment)
//
// Contract:
//   * Moves money AT MOST ONCE. A deterministic Stripe idempotency key is
//     ALWAYS required (caller passes idempotency_key, or reference_type +
//     reference_id from which we derive `csc:<type>:<id>`). There is no
//     random-key fallback — a money mover must not fail open.
//   * Never throws on a card decline → returns 200 { ok:false, status }.
//   * Returns 5xx ONLY on indeterminate/transient/config failures
//     (Stripe connection/API/auth/invalid-request, DB errors). Callers
//     treat 5xx as "outcome unknown — safe to retry under the SAME
//     idempotency key", which dedupes at Stripe.
//   * Never charges across tenants: connected account, customer, and the
//     payment method are ALL resolved server-side from (org, owner).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Guard against fat-finger / bad-caller amounts. Stripe's minimum for
// CAD/USD card charges is 50 cents; cap at $10,000 so a bug can't drain a
// card. These bounds assume a two-decimal currency — enforced by the
// currency allow-list below (no zero-decimal currencies accepted).
const MIN_AMOUNT_CENTS = 50;
const MAX_AMOUNT_CENTS = 1_000_000;

// Snout is a CAD/USD product. Restricting the currency keeps the cents-based
// amount guard honest (zero-decimal currencies like JPY would silently break
// the "$10,000 cap" invariant) and prevents a junk currency string from
// reaching Stripe.
const ALLOWED_CURRENCIES = new Set(["cad", "usd"]);

type Payload = {
  organization_id?: string;
  owner_id?: string;
  amount_cents?: number;
  currency?: string; // ISO code, default "cad"
  purpose?: string; // "deposit" | "no_show_fee" | "late_cancel_fee" | "invoice" | "other"
  reference_type?: string; // e.g. "deposit", "reservation"
  reference_id?: string; // the domain row id, for idempotency + metadata
  payment_method_id?: string; // explicit Stripe PM; else owner's default
  description?: string; // statement/metadata
  idempotency_key?: string; // explicit override of the derived key
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "Stripe not configured" }, 503);

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });

  try {
    // ── Auth ────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    let role: string | undefined;
    let callerSub: string | undefined;
    try {
      const seg = jwt.split(".")[1] ?? "";
      const padded = seg + "=".repeat((4 - (seg.length % 4)) % 4);
      const payloadJson = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
      const claims = JSON.parse(payloadJson) as { role?: string; sub?: string };
      role = claims.role;
      callerSub = claims.sub;
    } catch {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => null)) as Payload | null;
    if (!body) return json({ error: "Invalid JSON" }, 400);

    const organizationId = body.organization_id;
    const ownerId = body.owner_id;
    if (!organizationId || !ownerId) {
      return json({ error: "organization_id and owner_id are required" }, 400);
    }

    // Validate amount — never hand Stripe a bad number.
    const amountCents = body.amount_cents;
    if (
      typeof amountCents !== "number" ||
      !Number.isInteger(amountCents) ||
      amountCents < MIN_AMOUNT_CENTS ||
      amountCents > MAX_AMOUNT_CENTS
    ) {
      return json(
        { error: `amount_cents must be an integer between ${MIN_AMOUNT_CENTS} and ${MAX_AMOUNT_CENTS}` },
        400,
      );
    }

    // Validate currency (string + allow-list) before it touches Stripe.
    const currencyRaw = body.currency ?? "cad";
    if (typeof currencyRaw !== "string") {
      return json({ error: "currency must be a 3-letter ISO code" }, 400);
    }
    const currency = currencyRaw.toLowerCase();
    if (!ALLOWED_CURRENCIES.has(currency)) {
      return json({ error: `Unsupported currency '${currency}'` }, 400);
    }

    const purpose = body.purpose ?? "other";

    // Idempotency anchor is MANDATORY — fail closed. Either an explicit key,
    // or BOTH reference_type and reference_id (a half-specified pair is a
    // client error, not a silent fall-through to an un-deduped charge).
    let idempotencyKey = body.idempotency_key;
    if (!idempotencyKey) {
      if (body.reference_type && body.reference_id) {
        // Logical identity = the domain reference. Amount is intentionally
        // NOT in the key: a retry of the same logical charge must dedupe,
        // and if the amount ever genuinely differs for the same reference
        // Stripe raises an idempotency error (handled → 409) rather than
        // silently creating a second charge.
        idempotencyKey = `csc:${body.reference_type}:${body.reference_id}`;
      } else {
        return json(
          { error: "idempotency_key, or both reference_type and reference_id, are required" },
          400,
        );
      }
    }

    const isServiceRole = role === "service_role";
    if (!isServiceRole) {
      // Interactive caller: must be an active manager+ of THIS org.
      if (!callerSub) return json({ error: "Unauthorized" }, 401);
      const { data: membership, error: memErr } = await admin
        .from("memberships")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("profile_id", callerSub)
        .eq("active", true)
        .maybeSingle();
      if (memErr) throw memErr;
      if (
        !membership ||
        !["owner", "admin", "manager"].includes(membership.role as string)
      ) {
        return json({ error: "Forbidden — manager or above required" }, 403);
      }
    }

    // ── Validate the owner belongs to this org (mirrors create-setup-intent) ─
    const { data: owner, error: ownerErr } = await admin
      .from("owners")
      .select("id")
      .eq("id", ownerId)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (ownerErr) throw ownerErr;
    if (!owner) return json({ error: "Owner not found" }, 404);

    // ── Resolve the connected account (charging REQUIRES charges_enabled) ──
    const { data: acct, error: acctErr } = await admin
      .from("stripe_connect_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (acctErr) throw acctErr;
    if (!acct?.stripe_account_id) {
      return json({ error: "Operator is not set up to accept payments." }, 400);
    }
    if (!acct.charges_enabled) {
      return json({ error: "Operator's payment account cannot accept charges yet." }, 400);
    }
    const stripeAccount = acct.stripe_account_id as string;

    // ── Resolve the owner's Stripe customer on this account ───────────────
    const { data: custRow, error: custErr } = await admin
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("organization_id", organizationId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (custErr) throw custErr; // transient DB failure → 500, not a false "no customer"
    if (!custRow?.stripe_customer_id) {
      return json(
        { ok: false, status: "failed", code: "no_customer", error: "No saved customer for this owner" },
        200,
      );
    }
    const stripeCustomerId = custRow.stripe_customer_id as string;

    // ── Resolve which saved card to charge ────────────────────────────────
    // ALWAYS via payment_methods so Snout (not just Stripe's attach rule) is
    // authoritative that the card belongs to (org, owner). An explicit
    // payment_method_id is additionally constrained to that row, so a caller
    // cannot charge a PM that wasn't saved through create-setup-intent.
    let pmQuery = admin
      .from("payment_methods")
      .select("stripe_payment_method_id, card_brand, card_last_four, is_default, created_at")
      .eq("organization_id", organizationId)
      .eq("owner_id", ownerId)
      .not("stripe_payment_method_id", "is", null);
    if (body.payment_method_id) {
      pmQuery = pmQuery.eq("stripe_payment_method_id", body.payment_method_id);
    }
    const { data: pms, error: pmErr } = await pmQuery
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);
    if (pmErr) throw pmErr; // transient DB failure → 500, not a false "no card"
    const pm = pms?.[0];
    if (!pm?.stripe_payment_method_id) {
      return json(
        {
          ok: false,
          status: "failed",
          code: body.payment_method_id ? "unknown_card" : "no_card",
          error: body.payment_method_id
            ? "That card is not on file for this owner"
            : "No saved card on file for this owner",
        },
        200,
      );
    }
    const paymentMethodId = pm.stripe_payment_method_id as string;
    const card = { brand: pm.card_brand ?? null, last4: pm.card_last_four ?? null };

    // ── Create + confirm the off-session PaymentIntent ────────────────────
    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency,
          customer: stripeCustomerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          description: body.description ?? `Snout ${purpose}`,
          metadata: {
            organization_id: organizationId,
            owner_id: ownerId,
            purpose,
            ...(body.reference_type ? { reference_type: body.reference_type } : {}),
            ...(body.reference_id ? { reference_id: body.reference_id } : {}),
            source: "charge-saved-card",
          },
        },
        { stripeAccount, idempotencyKey },
      );

      if (intent.status === "succeeded") {
        return json({
          ok: true,
          status: "succeeded",
          payment_intent_id: intent.id,
          charge_id:
            typeof intent.latest_charge === "string"
              ? intent.latest_charge
              : intent.latest_charge?.id ?? null,
          amount_cents: amountCents,
          currency,
          card,
        });
      }

      // Non-succeeded WITHOUT a throw is rare for confirm:true off_session.
      // Only `requires_action` is genuinely recoverable via SCA; every other
      // status (requires_payment_method, processing, canceled, …) is treated
      // as failed so callers don't prompt for authentication that won't come.
      return json({
        ok: false,
        status: intent.status === "requires_action" ? "requires_action" : "failed",
        payment_intent_id: intent.id,
        amount_cents: amountCents,
        currency,
        error: `Charge not completed (status: ${intent.status})`,
      });
    } catch (e) {
      const err = e as Stripe.errors.StripeError;
      const type = (err as { type?: string }).type;

      // Only a genuine card error is a structured decline. Everything else
      // (connection/API/rate-limit = indeterminate or transient; invalid
      // request/auth/permission = config or programming bug; idempotency
      // reuse = conflicting params) must NOT be reported as a clean "failed",
      // or an exactly-once mover degrades into a silent drop or double-charge.
      if (type === "StripeCardError") {
        const code = (err as { code?: string }).code ?? null;
        const declineCode = (err as { decline_code?: string }).decline_code ?? null;
        const piId =
          (err as { payment_intent?: { id?: string } }).payment_intent?.id ??
          (err as { raw?: { payment_intent?: { id?: string } } }).raw?.payment_intent?.id ??
          null;
        const needsAuth = code === "authentication_required";
        console.warn(
          `charge-saved-card declined: org ${organizationId} owner ${ownerId} amount ${amountCents} code=${code} decline=${declineCode}`,
        );
        return json({
          ok: false,
          status: needsAuth ? "requires_action" : "failed",
          payment_intent_id: piId,
          amount_cents: amountCents,
          currency,
          code,
          decline_code: declineCode,
          error: err.message ?? "Card was declined",
        });
      }

      if (type === "StripeIdempotencyError") {
        // Same key, different params — almost always a caller bug (amount
        // changed for the same reference). Surface it loudly, don't charge.
        console.error(`charge-saved-card idempotency conflict: key reused with different params (org ${organizationId})`);
        return json(
          { ok: false, status: "failed", code: "idempotency_conflict", error: "A different charge already used this idempotency key" },
          409,
        );
      }

      // Indeterminate / transient / config → 5xx via the outer catch so the
      // caller treats the outcome as unknown and can safely retry under the
      // SAME (deterministic) idempotency key.
      throw e;
    }
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`charge-saved-card internal error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
