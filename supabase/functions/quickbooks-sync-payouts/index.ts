// 6.6a: Sync ready processor_payouts to QBO as Bank Deposit entities.
//
// For each payout in state='ready':
//   - Resolve the operator's chosen fee account (default_fee_account_id
//     on quickbooks_accounts; required for the negative fee line).
//   - Resolve the deposit account (Bank or Undeposited Funds; we use
//     the existing default_deposit_account_id).
//   - Build the Deposit body:
//       Line 1+: each payment in this payout, linked-txn back to the
//                QBO Payment that originally hit Undeposited Funds.
//       Line N: a single negative summary line on the fee account
//                for the total processor fees in the batch.
//   - POST to /v3/company/{realmId}/deposit
//   - Persist a quickbooks_entity_mappings row with
//     qbo_entity_type='Deposit' and snout_table='processor_payouts'.
//   - Flip processor_payouts.state to 'synced' on success, 'failed'
//     with last_error on failure.
//
// Triggered:
//   - On-demand from a UI button (operator authenticates as admin).
//   - On a cron tick (service-role bearer).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";
import {
  createJournalEntry,
  getTokenContext,
  type QboJournalEntryInput,
  type QboJournalEntryLine,
  type QboTokenContext,
} from "../_shared/quickbooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QBO_CRON_SECRET = Deno.env.get("QBO_CRON_SECRET");
const INTUIT_CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID");
const INTUIT_CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET");

const PICKUP_LIMIT = 25;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!INTUIT_CLIENT_ID || !INTUIT_CLIENT_SECRET) {
    return json({ error: "QuickBooks integration is not configured" }, 503);
  }

  // Auth: accept either a user JWT (admin) or service-role bearer
  // (cron / SQL pg_net invocation, like other QBO functions).
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const isServiceRole =
    (!!SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) ||
    (!!QBO_CRON_SECRET && token === QBO_CRON_SECRET);

  let orgIdFilter: string | null = null;
  if (isServiceRole) {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.org_id === "string") orgIdFilter = body.org_id;
    // Without org_id, the cron path syncs all orgs.
  } else {
    const ctx = await requireOrgAdmin(req);
    if (!ctx) return json({ error: "Unauthorized" }, 401);
    orgIdFilter = ctx.orgId;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Pull ready payouts that don't already have a Deposit mapping.
  let query = admin
    .from("processor_payouts")
    .select("*")
    .eq("state", "ready")
    .order("payout_date")
    .limit(PICKUP_LIMIT);
  if (orgIdFilter) query = query.eq("organization_id", orgIdFilter);
  const { data: payouts, error: payoutsErr } = await query;
  if (payoutsErr) {
    return json({ error: "Could not list payouts", details: payoutsErr.message }, 500);
  }
  if (!payouts || payouts.length === 0) {
    return json({ ok: true, processed: 0, succeeded: 0, failed: 0 });
  }

  let succeeded = 0;
  let failed = 0;
  const failures: Array<{ payout_id: string; reason: string }> = [];
  const tokenCache = new Map<string, QboTokenContext | null>();

  for (const p of payouts as Array<{
    id: string;
    organization_id: string;
    processor: string;
    processor_payout_id: string;
    gross_cents: number;
    fee_cents: number;
    net_cents: number;
    payout_date: string;
    currency: "CAD" | "USD";
    description: string | null;
  }>) {
    try {
      // Token context (cached per org).
      let ctx = tokenCache.get(p.organization_id);
      if (ctx === undefined) {
        ctx = await getTokenContext({
          admin,
          orgId: p.organization_id,
          clientId: INTUIT_CLIENT_ID,
          clientSecret: INTUIT_CLIENT_SECRET,
        });
        tokenCache.set(p.organization_id, ctx);
      }
      if (!ctx) {
        const reason = "QBO not connected for this org";
        await markFailed(admin, p.id, reason);
        failed += 1;
        failures.push({ payout_id: p.id, reason });
        continue;
      }

      // Three accounts in play, all required:
      //   - Bank account (where the Deposit lands; DepositToAccountRef).
      //   - Source account (Undeposited Funds where Payments posted;
      //     used as DepositLineDetail.AccountRef for the gross line).
      //   - Fee account (operator-chosen Expense; AccountRef on the
      //     negative fee line).
      const { data: account } = await admin
        .from("quickbooks_accounts")
        .select(
          "default_deposit_account_id, default_deposit_account_name, default_bank_account_id, default_bank_account_name, default_fee_account_id, default_fee_account_name",
        )
        .eq("organization_id", p.organization_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!account?.default_bank_account_id) {
        const reason =
          "No QBO Bank account selected as the deposit destination. Pick one from the QuickBooks settings tab.";
        await markFailed(admin, p.id, reason);
        failed += 1;
        failures.push({ payout_id: p.id, reason });
        continue;
      }
      if (!account?.default_deposit_account_id) {
        const reason =
          "No source account selected (Undeposited Funds). Pick one from the QuickBooks settings tab.";
        await markFailed(admin, p.id, reason);
        failed += 1;
        failures.push({ payout_id: p.id, reason });
        continue;
      }
      if (!account?.default_fee_account_id) {
        const reason =
          "No processor-fee expense account selected. Pick one from the QuickBooks settings tab.";
        await markFailed(admin, p.id, reason);
        failed += 1;
        failures.push({ payout_id: p.id, reason });
        continue;
      }

      // Build the Journal Entry lines. The double-entry posting:
      //   Debit Bank account by net (= gross - fee)
      //   Debit Fee account by fee
      //   Credit Source account (Undeposited Funds) by gross
      // Total debits = total credits = gross. Net effect: Bank rises
      // by net, Fee Expense rises by fee, Undeposited Funds drops by
      // gross. Same accounting outcome as a Bank Deposit.
      //
      // We picked Journal Entry over Deposit because the QBO Deposit
      // endpoint rejects valid payloads on Canadian-sandbox realms
      // with multicurrency enabled (code 6000, empty element field).
      // Journal Entries have no such constraint.
      const grossDollars = Number((p.gross_cents / 100).toFixed(2));
      const feeDollars = Number((p.fee_cents / 100).toFixed(2));
      const netDollars = Number(((p.gross_cents - p.fee_cents) / 100).toFixed(2));

      if (grossDollars <= 0) {
        const reason = "Payout has zero gross — nothing to post.";
        await markFailed(admin, p.id, reason);
        failed += 1;
        failures.push({ payout_id: p.id, reason });
        continue;
      }

      const lines: QboJournalEntryLine[] = [];
      // Debit Bank by net amount
      lines.push({
        DetailType: "JournalEntryLineDetail",
        Amount: netDollars,
        Description: `${p.processor} payout ${p.processor_payout_id} (net deposit)`,
        JournalEntryLineDetail: {
          PostingType: "Debit",
          AccountRef: { value: account.default_bank_account_id },
        },
      });
      // Debit Fee account by fee amount (only if fees > 0)
      if (feeDollars > 0) {
        lines.push({
          DetailType: "JournalEntryLineDetail",
          Amount: feeDollars,
          Description: `${p.processor} processor fees for payout ${p.processor_payout_id}`,
          JournalEntryLineDetail: {
            PostingType: "Debit",
            AccountRef: { value: account.default_fee_account_id },
          },
        });
      }
      // Credit Source (Undeposited Funds) by gross amount
      lines.push({
        DetailType: "JournalEntryLineDetail",
        Amount: grossDollars,
        Description: `${p.processor} payout ${p.processor_payout_id} (gross from undeposited funds)`,
        JournalEntryLineDetail: {
          PostingType: "Credit",
          AccountRef: { value: account.default_deposit_account_id },
        },
      });

      const input: QboJournalEntryInput = {
        Line: lines,
        TxnDate: p.payout_date,
        PrivateNote: p.description ?? `${p.processor} payout ${p.processor_payout_id}`,
        CurrencyRef: { value: p.currency },
        DocNumber: p.processor_payout_id.slice(0, 21),
      };

      // 6.6a: persist request/response in the row for debug visibility.
      await admin
        .from("processor_payouts")
        .update({ last_request_body: input as unknown as Record<string, unknown> })
        .eq("id", p.id);
      const result = await createJournalEntry(ctx, input);
      if (!result.ok) {
        await admin
          .from("processor_payouts")
          .update({ last_response_body: JSON.stringify(result) })
          .eq("id", p.id);
        const reason = result.error;
        await markFailed(admin, p.id, reason);
        failed += 1;
        failures.push({ payout_id: p.id, reason });
        continue;
      }
      await admin
        .from("processor_payouts")
        .update({ last_response_body: JSON.stringify({ ok: true, qboId: result.data.JournalEntry.Id }) })
        .eq("id", p.id);

      const je = result.data.JournalEntry;
      // Persist mapping + flip state. qbo_entity_type='JournalEntry'
      // so the reconciliation export and Failed Syncs panel surface
      // these correctly.
      await admin.from("quickbooks_entity_mappings").insert({
        organization_id: p.organization_id,
        snout_table: "processor_payouts",
        snout_id: p.id,
        qbo_entity_type: "JournalEntry",
        qbo_id: je.Id,
        sync_token: je.SyncToken,
        sync_state: "synced",
        last_synced_at: new Date().toISOString(),
      });
      await admin
        .from("processor_payouts")
        .update({ state: "synced" })
        .eq("id", p.id);
      succeeded += 1;
    } catch (e) {
      const reason = (e as Error).message;
      await markFailed(admin, p.id, reason);
      failed += 1;
      failures.push({ payout_id: p.id, reason });
    }
  }

  return json({
    ok: true,
    processed: payouts.length,
    succeeded,
    failed,
    failures: failures.slice(0, 20),
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markFailed(admin: any, payoutId: string, reason: string) {
  await admin
    .from("processor_payouts")
    .update({ state: "failed", description: `Sync failed: ${reason}` })
    .eq("id", payoutId);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
