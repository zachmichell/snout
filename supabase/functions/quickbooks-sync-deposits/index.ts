// Deposit-prepayment series: sync deposit lifecycle events to QBO as Journal
// Entries. Modeled on quickbooks-sync-credit-ledger.
//
// A deposit collected before service is a customer PREPAYMENT — cash received
// against a liability, recognized as income only when the booking is fulfilled
// (the invoice does that). Legs (each a balanced JE, tracked by a distinct
// qbo_entity_type so one deposit can carry several):
//
//   DepositCollect (paid):
//     Dr Undeposited Funds            / Cr Customer Deposits (liability)
//   DepositApply (credited to an invoice — PR-5 netting):
//     Dr Customer Deposits (liability) / Cr Accounts Receivable [Entity=customer]
//       The invoice already booked the income (Dr A/R / Cr Income); the apply
//       settles that receivable with the prepayment, so it credits A/R — NOT
//       Income (that would double-count revenue).
//   DepositApplyReverse (applied deposit later un-applied, e.g. refunded):
//     Dr Accounts Receivable [Entity=customer] / Cr Customer Deposits (liability)
//   DepositForfeit (paid deposit forfeited):
//     Dr Customer Deposits (liability) / Cr Forfeited Deposit Income
//   DepositRefund (paid deposit refunded):
//     Dr Customer Deposits (liability) / Cr Undeposited Funds
//
// All legs gated on paid_at IS NOT NULL (no cash => no JE). Candidates come from
// deposits_needing_qbo_sync, which anti-joins the mapping table (only
// outstanding legs, oldest-first). Release legs (apply/forfeit/refund/reverse)
// only post once the collect leg is synced, so the liability is never released
// before it is established. Missing accounts soft-fail (no mapping) and
// auto-retry once configured — never auto-picked.
//
// Currency: like the other JE syncs, legs post in the connection's home
// currency (no CurrencyRef).

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

type Stage = "collect" | "apply" | "apply_reverse" | "forfeit" | "refund";

const QBO_ENTITY_TYPE: Record<Stage, string> = {
  collect: "DepositCollect",
  apply: "DepositApply",
  apply_reverse: "DepositApplyReverse",
  forfeit: "DepositForfeit",
  refund: "DepositRefund",
};

const DOC_SUFFIX: Record<Stage, string> = {
  collect: "C",
  apply: "A",
  apply_reverse: "V",
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
  invoice_id: string | null;
  owner_id: string | null;
  credited_to_invoice_cents: number;
  has_live_credit: boolean;
  applied_at: string | null;
};

type AccountSettings = {
  default_deposit_account_id: string | null;
  default_customer_deposit_liability_account_id: string | null;
  default_forfeited_deposit_income_account_id: string | null;
  default_accounts_receivable_account_id: string | null;
};

type WorkItem = { deposit: DepositRow; stage: Stage; eventAt: string; amountCents: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!INTUIT_CLIENT_ID || !INTUIT_CLIENT_SECRET) {
    return json({ error: "QBO not configured" }, 503);
  }

  // Resolve the caller. Cron invokes with the vault service_role_key, which can
  // drift from the env SUPABASE_SERVICE_ROLE_KEY — so after the fast string
  // checks we fall back to verifying the JWT's role claim.
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

  // Expand each deposit into its legs. collect first (establishes the
  // liability); then exactly one of apply / apply_reverse (mutually exclusive
  // by has_live_credit); then forfeit/refund.
  const allItems: WorkItem[] = [];
  for (const d of deposits as DepositRow[]) {
    if (!d.paid_at || (d.amount_cents ?? 0) <= 0) continue;
    allItems.push({ deposit: d, stage: "collect", eventAt: d.paid_at, amountCents: d.amount_cents });
    if (d.has_live_credit) {
      // Date the apply at the credit's posting time (== invoice finalization),
      // not the deposit collection date, so the A/R settlement never predates
      // the invoice that created the receivable.
      allItems.push({ deposit: d, stage: "apply", eventAt: d.applied_at ?? d.paid_at, amountCents: d.credited_to_invoice_cents });
    }
    // apply_reverse is added below only when a DepositApply mapping exists
    // (decided after we load existing mappings).
    if (d.forfeited_at) {
      allItems.push({ deposit: d, stage: "forfeit", eventAt: d.forfeited_at, amountCents: d.amount_cents });
    }
    if (d.refunded_at) {
      allItems.push({ deposit: d, stage: "refund", eventAt: d.refunded_at, amountCents: d.amount_cents });
    }
  }

  const depIds = Array.from(new Set((deposits as DepositRow[]).map((d) => d.id)));
  const { data: existingMaps } = await admin
    .from("quickbooks_entity_mappings")
    .select("snout_id, qbo_entity_type")
    .eq("snout_table", "deposits")
    .in("qbo_entity_type", Object.values(QBO_ENTITY_TYPE))
    .in("snout_id", depIds)
    .is("deleted_at", null);
  const done = new Set<string>();
  const collectSynced = new Set<string>();
  const applySynced = new Set<string>();
  for (const m of (existingMaps ?? []) as Array<{ snout_id: string; qbo_entity_type: string }>) {
    done.add(`${m.snout_id}:${m.qbo_entity_type}`);
    if (m.qbo_entity_type === QBO_ENTITY_TYPE.collect) collectSynced.add(m.snout_id);
    if (m.qbo_entity_type === QBO_ENTITY_TYPE.apply) applySynced.add(m.snout_id);
  }

  // Add apply_reverse legs: deposit was applied (DepositApply synced) but is no
  // longer applied (no live credit — it was reversed).
  for (const d of deposits as DepositRow[]) {
    if (!d.has_live_credit && applySynced.has(d.id) && d.credited_to_invoice_cents > 0) {
      allItems.push({
        deposit: d,
        stage: "apply_reverse",
        eventAt: d.refunded_at ?? d.paid_at ?? d.created_at,
        amountCents: d.credited_to_invoice_cents,
      });
    }
  }

  // Order legs so collect precedes its releases, and reverse precedes refund.
  const STAGE_ORDER: Record<Stage, number> = {
    collect: 0, apply: 1, apply_reverse: 2, forfeit: 3, refund: 4,
  };
  const pending = allItems
    .filter((i) => !done.has(`${i.deposit.id}:${QBO_ENTITY_TYPE[i.stage]}`))
    .sort((a, b) =>
      a.deposit.id === b.deposit.id
        ? STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]
        : 0
    );

  if (pending.length === 0) {
    return json({ ok: true, processed: 0, succeeded: 0, failed: 0, skipped: 0 });
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const failures: Array<{ id: string; stage: Stage; reason: string }> = [];
  const tokenCache = new Map<string, QboTokenContext | null>();
  const accountCache = new Map<string, AccountSettings | null>();
  const customerCache = new Map<string, string | null>();

  for (const item of pending) {
    const { deposit: d, stage } = item;
    try {
      // Never release a liability the collect leg hasn't established.
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
            "default_deposit_account_id, default_customer_deposit_liability_account_id, default_forfeited_deposit_income_account_id, default_accounts_receivable_account_id",
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

      // Apply legs post against A/R with the customer as the JE-line Entity.
      let customerId: string | null = null;
      if (stage === "apply" || stage === "apply_reverse") {
        if (!d.owner_id) {
          failed += 1;
          failures.push({ id: d.id, stage, reason: "deposit has no owner; cannot resolve QBO customer" });
          continue;
        }
        customerId = customerCache.get(d.owner_id) ?? null;
        if (!customerCache.has(d.owner_id)) {
          const { data: ownerMap } = await admin
            .from("quickbooks_entity_mappings")
            .select("qbo_id, sync_state")
            .eq("organization_id", d.organization_id)
            .eq("snout_table", "owners")
            .eq("snout_id", d.owner_id)
            .is("deleted_at", null)
            .maybeSingle();
          customerId = (ownerMap && ownerMap.sync_state === "synced" && ownerMap.qbo_id)
            ? (ownerMap.qbo_id as string)
            : null;
          customerCache.set(d.owner_id, customerId);
        }
        if (!customerId) {
          failed += 1;
          failures.push({ id: d.id, stage, reason: "owner not yet synced to QBO — deferred" });
          continue;
        }
      }

      const built = buildJournalLines({
        stage,
        amountCents: item.amountCents,
        settings,
        customerId,
      });
      if (!built.ok) {
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

function buildJournalLines(args: {
  stage: Stage;
  amountCents: number;
  settings: AccountSettings;
  customerId: string | null;
}): LineBuildResult {
  const { stage, settings: s, customerId } = args;
  const amount = Number((args.amountCents / 100).toFixed(2));
  if (amount <= 0) return { ok: false, error: "Leg amount is zero" };

  const uf = s.default_deposit_account_id;
  const liability = s.default_customer_deposit_liability_account_id;
  const forfeitIncome = s.default_forfeited_deposit_income_account_id;
  const ar = s.default_accounts_receivable_account_id;

  const line = (
    side: "Debit" | "Credit",
    account: string,
    description: string,
    entityCustomer?: string,
  ): QboJournalEntryLine => ({
    DetailType: "JournalEntryLineDetail",
    Amount: amount,
    Description: description,
    JournalEntryLineDetail: {
      PostingType: side,
      AccountRef: { value: account },
      ...(entityCustomer
        ? { Entity: { value: entityCustomer, type: "Customer" as const } }
        : {}),
    },
  });

  if (stage === "collect") {
    if (!uf) return { ok: false, error: "Undeposited Funds account not selected" };
    if (!liability) return { ok: false, error: "Customer Deposits liability account not selected" };
    return {
      ok: true,
      lines: [
        line("Debit", uf, "Deposit collected — cash received"),
        line("Credit", liability, "Deposit collected — customer prepayment"),
      ],
    };
  }

  if (stage === "apply") {
    if (!liability) return { ok: false, error: "Customer Deposits liability account not selected" };
    if (!ar) return { ok: false, error: "Accounts Receivable account not selected" };
    if (!customerId) return { ok: false, error: "QBO customer not resolved" };
    return {
      ok: true,
      lines: [
        line("Debit", liability, "Deposit applied — prepayment used"),
        line("Credit", ar, "Deposit applied — invoice receivable settled", customerId),
      ],
    };
  }

  if (stage === "apply_reverse") {
    if (!liability) return { ok: false, error: "Customer Deposits liability account not selected" };
    if (!ar) return { ok: false, error: "Accounts Receivable account not selected" };
    if (!customerId) return { ok: false, error: "QBO customer not resolved" };
    return {
      ok: true,
      lines: [
        line("Debit", ar, "Deposit application reversed — receivable restored", customerId),
        line("Credit", liability, "Deposit application reversed — prepayment restored"),
      ],
    };
  }

  if (stage === "forfeit") {
    if (!liability) return { ok: false, error: "Customer Deposits liability account not selected" };
    if (!forfeitIncome) return { ok: false, error: "Forfeited Deposit Income account not selected" };
    return {
      ok: true,
      lines: [
        line("Debit", liability, "Deposit forfeited — liability released"),
        line("Credit", forfeitIncome, "Deposit forfeited — income recognized"),
      ],
    };
  }

  // refund
  if (!liability) return { ok: false, error: "Customer Deposits liability account not selected" };
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
