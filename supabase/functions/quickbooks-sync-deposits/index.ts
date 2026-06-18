// Deposit-prepayment series (PR-3/4): sync deposit lifecycle events to QBO as
// Journal Entries. Modeled on quickbooks-sync-credit-ledger.
//
// A deposit collected before service is a customer PREPAYMENT — cash received
// against a liability, recognized as income only when the booking is fulfilled
// (the "apply" leg ships in PR-5 with invoice netting). This function posts the
// self-contained legs that don't depend on netting:
//
//   DepositCollect  (deposit was paid):
//     Debit  Undeposited Funds            (default_deposit_account)
//     Credit Customer Deposits (liability) (default_customer_deposit_liability_account)
//
//   DepositForfeit  (paid deposit forfeited):
//     Debit  Customer Deposits (liability)
//     Credit Forfeited Deposit Income      (default_forfeited_deposit_income_account)
//
//   DepositRefund   (paid deposit refunded):
//     Debit  Customer Deposits (liability)
//     Credit Undeposited Funds             (default_deposit_account)
//
// Every leg is gated on paid_at IS NOT NULL: a deposit that was never collected
// involved no cash, so it produces no GL entries.
//
// Ordering / coverage: candidates come from the deposits_needing_qbo_sync RPC,
// which anti-joins the mapping table and returns ONLY deposits with at least one
// outstanding leg, oldest-first. That drains a backlog deterministically and can
// never let a fully-synced deposit crowd out — or an old unsynced leg be starved
// by — newer activity.
//
// Invariant — release after collect: a forfeit/refund leg debits the
// Customer-Deposit liability that the collect leg credited. We never post a
// release leg unless the collect leg is already synced (a prior run) or syncs
// earlier in this run; otherwise the release is deferred (skipped) and retried,
// so the GL can never carry a one-sided release with no originating collect.
//
// Each leg is tracked by its own mapping row keyed by a distinct qbo_entity_type
// (DepositCollect / DepositForfeit / DepositRefund); the unique index
// (org, snout_table, snout_id, qbo_entity_type) guarantees one JE per leg.
// Missing-account cases soft-fail (no mapping) so they auto-retry once the
// operator configures the accounts — we never auto-pick an account.
//
// Currency: like the payouts and credit-ledger JE syncs, legs are posted in the
// connection's home currency (no CurrencyRef). Multi-currency deposits share
// that known limitation.

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
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const QBO_CRON_SECRET = Deno.env.get("QBO_CRON_SECRET");
const INTUIT_CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID");
const INTUIT_CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET");

const PICKUP_LIMIT = 50;

type Stage = "collect" | "forfeit" | "refund";

const QBO_ENTITY_TYPE: Record<Stage, string> = {
  collect: "DepositCollect",
  forfeit: "DepositForfeit",
  refund: "DepositRefund",
};

const DOC_SUFFIX: Record<Stage, string> = {
  collect: "C",
  forfeit: "F",
  refund: "R",
};

type DepositRow = {
  id: string;
  organization_id: string;
  amount_cents: number;
  status: string;
  paid_at: string | null;
  forfeited_at: string | null;
  refunded_at: string | null;
  created_at: string;
};

type AccountSettings = {
  default_deposit_account_id: string | null;
  default_customer_deposit_liability_account_id: string | null;
  default_forfeited_deposit_income_account_id: string | null;
};

type WorkItem = { deposit: DepositRow; stage: Stage; eventAt: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!INTUIT_CLIENT_ID || !INTUIT_CLIENT_SECRET) {
    return json({ error: "QBO not configured" }, 503);
  }

  // Resolve the caller. Cron invokes with the vault service_role_key, which can
  // drift from the env SUPABASE_SERVICE_ROLE_KEY — so after the fast string
  // checks we fall back to verifying the JWT's role claim, which holds for any
  // valid service-role token regardless of which key was used.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  let isServiceRole =
    (!!SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) ||
    (!!QBO_CRON_SECRET && token === QBO_CRON_SECRET);
  if (!isServiceRole && token && SUPABASE_ANON_KEY) {
    try {
      const probe = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data: claims } = await probe.auth.getClaims(token);
      if ((claims?.claims as { role?: string } | undefined)?.role === "service_role") {
        isServiceRole = true;
      }
    } catch {
      // fall through to the admin check
    }
  }

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

  // Only deposits with at least one outstanding leg, oldest-first. The RPC
  // anti-joins the mapping table so fully-synced deposits are never fetched and
  // can't crowd out (or starve) work.
  const { data: deposits, error: depErr } = await admin.rpc(
    "deposits_needing_qbo_sync",
    { _org: orgIdFilter, _limit: PICKUP_LIMIT },
  );
  if (depErr) {
    return json({ error: "Could not list deposits", details: depErr.message }, 500);
  }
  if (!deposits || deposits.length === 0) {
    return json({ ok: true, processed: 0, succeeded: 0, failed: 0, skipped: 0 });
  }

  // Expand each deposit into its legs: collect first (so the liability is
  // established before any release), then AT MOST ONE release leg. forfeit and
  // refund are mutually exclusive (DB CHECK enforces it); the else-if is a
  // belt-and-suspenders guard so we never double-debit the liability.
  const allItems: WorkItem[] = [];
  for (const d of deposits as DepositRow[]) {
    if (!d.paid_at || (d.amount_cents ?? 0) <= 0) continue;
    allItems.push({ deposit: d, stage: "collect", eventAt: d.paid_at });
    if (d.forfeited_at) {
      allItems.push({ deposit: d, stage: "forfeit", eventAt: d.forfeited_at });
    } else if (d.refunded_at) {
      allItems.push({ deposit: d, stage: "refund", eventAt: d.refunded_at });
    }
  }
  if (allItems.length === 0) {
    return json({ ok: true, processed: 0, succeeded: 0, failed: 0, skipped: 0 });
  }

  // Existing synced legs for these deposits. Mappings are only written on a
  // successful post, so any present mapping is a synced leg.
  const depIds = Array.from(new Set(allItems.map((i) => i.deposit.id)));
  const { data: existingMaps } = await admin
    .from("quickbooks_entity_mappings")
    .select("snout_id, qbo_entity_type")
    .eq("snout_table", "deposits")
    .in("qbo_entity_type", Object.values(QBO_ENTITY_TYPE))
    .in("snout_id", depIds)
    .is("deleted_at", null);
  const done = new Set<string>();
  // Deposits whose collect leg is already on the books (prior run).
  const collectSynced = new Set<string>();
  for (const m of (existingMaps ?? []) as Array<{ snout_id: string; qbo_entity_type: string }>) {
    done.add(`${m.snout_id}:${m.qbo_entity_type}`);
    if (m.qbo_entity_type === QBO_ENTITY_TYPE.collect) collectSynced.add(m.snout_id);
  }

  // Skip legs already synced. (collect is ordered before its release leg, so a
  // collect posted this run is visible to the release leg via collectSynced.)
  const pending = allItems.filter(
    (i) => !done.has(`${i.deposit.id}:${QBO_ENTITY_TYPE[i.stage]}`),
  );

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const failures: Array<{ id: string; stage: Stage; reason: string }> = [];
  const tokenCache = new Map<string, QboTokenContext | null>();
  const accountCache = new Map<string, AccountSettings | null>();

  for (const item of pending) {
    const { deposit: d, stage } = item;
    try {
      // Never release a liability the collect leg hasn't established. Defer
      // (retry next run) rather than post a one-sided entry.
      if (stage !== "collect" && !collectSynced.has(d.id)) {
        skipped += 1;
        failures.push({ id: d.id, stage, reason: "deposit collect leg not yet synced — deferred" });
        continue;
      }

      let ctx = tokenCache.get(d.organization_id);
      if (ctx === undefined) {
        ctx = await getTokenContext({
          admin,
          orgId: d.organization_id,
          clientId: INTUIT_CLIENT_ID,
          clientSecret: INTUIT_CLIENT_SECRET,
        });
        tokenCache.set(d.organization_id, ctx);
      }
      if (!ctx) {
        failed += 1;
        failures.push({ id: d.id, stage, reason: "QBO not connected" });
        continue;
      }

      let settings = accountCache.get(d.organization_id);
      if (settings === undefined) {
        const { data: acct } = await admin
          .from("quickbooks_accounts")
          .select(
            "default_deposit_account_id, default_customer_deposit_liability_account_id, default_forfeited_deposit_income_account_id",
          )
          .eq("organization_id", d.organization_id)
          .is("deleted_at", null)
          .maybeSingle();
        settings = (acct ?? null) as AccountSettings | null;
        accountCache.set(d.organization_id, settings);
      }
      if (!settings) {
        failed += 1;
        failures.push({ id: d.id, stage, reason: "QBO not configured" });
        continue;
      }

      const built = buildJournalLines(stage, settings, d.amount_cents);
      if (!built.ok) {
        // Missing account: soft-fail with no mapping so it auto-retries once
        // the operator configures the account. Never auto-pick.
        failed += 1;
        failures.push({ id: d.id, stage, reason: built.error });
        continue;
      }

      const input: QboJournalEntryInput = {
        Line: built.lines,
        TxnDate: item.eventAt.slice(0, 10),
        DocNumber: `DEP-${d.id.slice(0, 8)}-${DOC_SUFFIX[stage]}`,
        PrivateNote: `Snout deposit ${stage} — ${d.id.slice(0, 8)}`,
      };

      const result = await createJournalEntry(ctx, input);
      if (!result.ok) {
        failed += 1;
        failures.push({ id: d.id, stage, reason: result.error });
        continue;
      }

      const je = result.data.JournalEntry;
      const { error: mapErr } = await admin
        .from("quickbooks_entity_mappings")
        .insert({
          organization_id: d.organization_id,
          snout_table: "deposits",
          snout_id: d.id,
          qbo_entity_type: QBO_ENTITY_TYPE[stage],
          qbo_id: je.Id,
          sync_token: je.SyncToken,
          sync_state: "synced",
          last_synced_at: new Date().toISOString(),
        });
      if (mapErr) {
        // The JE exists in QBO but we couldn't record the mapping. Surface it;
        // the deterministic DocNumber lets an operator spot/avoid a duplicate.
        // Do NOT mark collect as synced — a release leg must wait until the
        // collect mapping is durably recorded.
        failed += 1;
        failures.push({
          id: d.id,
          stage,
          reason: `JE ${je.Id} posted but mapping insert failed: ${mapErr.message}`,
        });
        continue;
      }
      if (stage === "collect") collectSynced.add(d.id);
      succeeded += 1;
    } catch (e) {
      failed += 1;
      failures.push({ id: d.id, stage, reason: (e as Error).message });
    }
  }

  return json({
    ok: true,
    processed: pending.length,
    succeeded,
    failed,
    skipped,
    failures: failures.slice(0, 20),
  });
});

type LineBuildResult =
  | { ok: true; lines: QboJournalEntryLine[] }
  | { ok: false; error: string };

function buildJournalLines(
  stage: Stage,
  s: AccountSettings,
  amountCents: number,
): LineBuildResult {
  const amount = Number((amountCents / 100).toFixed(2));
  if (amount <= 0) return { ok: false, error: "Deposit amount is zero" };

  const uf = s.default_deposit_account_id;
  const liability = s.default_customer_deposit_liability_account_id;
  const forfeitIncome = s.default_forfeited_deposit_income_account_id;

  const line = (
    side: "Debit" | "Credit",
    account: string,
    description: string,
  ): QboJournalEntryLine => ({
    DetailType: "JournalEntryLineDetail",
    Amount: amount,
    Description: description,
    JournalEntryLineDetail: { PostingType: side, AccountRef: { value: account } },
  });

  if (stage === "collect") {
    if (!uf) return { ok: false, error: "Undeposited Funds account not selected" };
    if (!liability) {
      return { ok: false, error: "Customer Deposits liability account not selected" };
    }
    return {
      ok: true,
      lines: [
        line("Debit", uf, "Deposit collected — cash received"),
        line("Credit", liability, "Deposit collected — customer prepayment"),
      ],
    };
  }

  if (stage === "forfeit") {
    if (!liability) {
      return { ok: false, error: "Customer Deposits liability account not selected" };
    }
    if (!forfeitIncome) {
      return { ok: false, error: "Forfeited Deposit Income account not selected" };
    }
    return {
      ok: true,
      lines: [
        line("Debit", liability, "Deposit forfeited — liability released"),
        line("Credit", forfeitIncome, "Deposit forfeited — income recognized"),
      ],
    };
  }

  // refund
  if (!liability) {
    return { ok: false, error: "Customer Deposits liability account not selected" };
  }
  if (!uf) return { ok: false, error: "Undeposited Funds account not selected" };
  return {
    ok: true,
    lines: [
      line("Debit", liability, "Deposit refunded — liability released"),
      line("Credit", uf, "Deposit refunded — cash returned"),
    ],
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
