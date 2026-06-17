// collect-deposit
//
// Collects a PENDING deposit by charging the owner's saved card, then records
// the result on the deposit row. First caller of the charge-saved-card
// keystone: composes that primitive (off-session charge, idempotency, decline
// handling in one place) and owns the deposit-domain bookkeeping.
//
// At-most-once design (hardened after adversarial review found a strand →
// double-charge vector):
//   1. Load the deposit (service role) → 404 if missing.
//   2. Authorize (service_role, or manager+ of the deposit's org) BEFORE
//      revealing any status (no cross-tenant status oracle).
//   3. ATOMIC CLAIM: UPDATE status 'pending' → 'processing' (guarded). If 0
//      rows, the deposit isn't pending (already paid / in flight) → 409. The
//      claim is the mutual-exclusion gate: a charged deposit is NEVER left in
//      'pending' (the only state the UI offers "Charge card"), so it can't be
//      re-charged.
//   4. Charge via charge-saved-card with reference_type='deposit',
//      reference_id=<deposit_id> (deterministic idempotency anchor).
//   5. Resolve:
//      - succeeded → finalize 'processing' → 'paid' + PI + collected_via.
//        If that write fails, leave it 'processing' (NOT pending) and report
//        needs_reconciliation — the stripe-connect-webhook deposit branch
//        finalizes it independently of Stripe's idempotency window.
//      - decline / no_card / requires_action (200 ok:false) → revert to
//        'pending' (no charge landed) and relay the reason.
//      - config / validation error (400/503, charge NOT attempted) → revert
//        to 'pending'; non-retryable message.
//      - indeterminate 5xx / idempotency_conflict (charge MAY have landed) →
//        leave 'processing'; the webhook reconciles if it did. Never revert
//        (reverting could re-expose it to a charge after the 24h key window).
//
// Auth: verify_jwt=true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

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

    const body = (await req.json().catch(() => null)) as { deposit_id?: string } | null;
    const depositId = body?.deposit_id;
    if (!depositId) return json({ error: "deposit_id is required" }, 400);

    // 1) Load.
    const { data: deposit, error: depErr } = await admin
      .from("deposits")
      .select("id, organization_id, owner_id, amount_cents, currency, status")
      .eq("id", depositId)
      .maybeSingle();
    if (depErr) throw depErr;
    if (!deposit) return json({ error: "Deposit not found" }, 404);

    // 2) Authorize BEFORE evaluating status (no cross-tenant status oracle).
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

    if (!deposit.amount_cents || deposit.amount_cents <= 0) {
      return json({ ok: false, status: "failed", code: "zero_amount", error: "Deposit has no amount to collect" }, 400);
    }

    // 3) Atomic claim: pending → processing. The mutual-exclusion gate.
    const { data: claimed, error: claimErr } = await admin
      .from("deposits")
      .update({ status: "processing" })
      .eq("id", deposit.id)
      .eq("status", "pending")
      .select("id");
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) {
      return json(
        { ok: false, status: "failed", code: "not_pending", error: "Deposit is not pending (already collected or in progress)" },
        409,
      );
    }

    // 4) Charge via the keystone. reference_type/id is the idempotency anchor.
    const { data: chargeData, error: chargeErr } = await admin.functions.invoke("charge-saved-card", {
      body: {
        organization_id: deposit.organization_id,
        owner_id: deposit.owner_id,
        amount_cents: deposit.amount_cents,
        currency: deposit.currency ?? "cad",
        purpose: "deposit",
        reference_type: "deposit",
        reference_id: deposit.id,
        description: "Reservation deposit",
      },
    });

    if (chargeErr) {
      // Non-2xx from the keystone. Read the structured body to tell apart
      // "never attempted" (safe to revert) from "maybe landed" (must not).
      const ctx = (chargeErr as { context?: Response }).context;
      const httpStatus = ctx?.status ?? 0;
      let kCode: string | undefined;
      try {
        kCode = (await ctx?.json?.())?.code;
      } catch {
        // body unreadable
      }
      console.error(
        `collect-deposit: charge-saved-card non-2xx for deposit ${deposit.id} — http=${httpStatus} code=${kCode ?? "?"}`,
      );

      if (httpStatus === 400 || httpStatus === 503) {
        // Config / validation: the charge was never attempted → safe to revert.
        await revertToPending(deposit.id);
        return json(
          { ok: false, status: "failed", code: kCode ?? "charge_misconfigured", error: "Charge could not be attempted — check payment setup" },
          httpStatus,
        );
      }
      if (httpStatus === 409 || kCode === "idempotency_conflict") {
        // A conflicting charge already exists for this deposit. Do NOT revert
        // and do NOT retry — leave it for reconciliation / the webhook.
        return json(
          { ok: false, status: "failed", code: "idempotency_conflict", error: "A conflicting charge already exists — reconcile in Stripe; do not retry" },
          409,
        );
      }
      // Indeterminate (5xx): the charge MAY have landed. Leave 'processing';
      // the webhook finalizes it to 'paid' if it did. Caller may retry — the
      // deterministic idempotency key dedupes a same-window retry.
      return json(
        { ok: false, status: "failed", code: "charge_unavailable", needs_reconciliation: true, error: "Charge outcome unknown — do not re-charge; it will reconcile automatically" },
        502,
      );
    }

    const result = chargeData as {
      ok?: boolean;
      status?: string;
      payment_intent_id?: string | null;
      code?: string | null;
      decline_code?: string | null;
      error?: string | null;
    };

    if (result?.ok && result.status === "succeeded") {
      // 5) Finalize processing → paid. We own the 'processing' row. Retry a
      // couple times so a transient DB blip doesn't strand a charged deposit.
      let updErr: { message: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await admin
          .from("deposits")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: result.payment_intent_id ?? null,
            collected_via: "saved_card",
          })
          .eq("id", deposit.id)
          .eq("status", "processing");
        updErr = error;
        if (!error) break;
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
      if (updErr) {
        // Money moved but the record write failed. Leave it 'processing' (the
        // UI won't re-offer "Charge card"); the webhook deposit branch will
        // finalize it to 'paid' by PI. Report it so staff don't re-charge.
        console.error(
          `collect-deposit: CHARGED but record write failed for deposit ${deposit.id} (PI ${result.payment_intent_id}):`,
          updErr.message,
        );
        return json({
          ok: true,
          status: "paid",
          deposit_id: deposit.id,
          payment_intent_id: result.payment_intent_id ?? null,
          amount_cents: deposit.amount_cents,
          recorded: false,
          needs_reconciliation: true,
        });
      }
      return json({
        ok: true,
        status: "paid",
        deposit_id: deposit.id,
        payment_intent_id: result.payment_intent_id ?? null,
        amount_cents: deposit.amount_cents,
        recorded: true,
      });
    }

    // Decline / no_card / requires_action (200 ok:false): no charge landed →
    // revert to pending so staff can retry or collect another way.
    await revertToPending(deposit.id);
    return json({
      ok: false,
      status: result?.status ?? "failed",
      deposit_id: deposit.id,
      code: result?.code ?? null,
      decline_code: result?.decline_code ?? null,
      error: result?.error ?? "Could not charge the saved card",
    });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`collect-deposit internal error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

// Release a claimed deposit back to 'pending' (only if still 'processing', so
// we never clobber a concurrent finalize).
async function revertToPending(depositId: string) {
  const { error } = await admin
    .from("deposits")
    .update({ status: "pending" })
    .eq("id", depositId)
    .eq("status", "processing");
  if (error) console.error(`collect-deposit: failed to revert deposit ${depositId} to pending:`, error.message);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
