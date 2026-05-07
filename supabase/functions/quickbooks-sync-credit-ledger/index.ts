// 6.6c: Sync credit_ledger rows to QBO as Journal Entries.
//
// Per-credit price is derived from the source purchase's linked
// owner_subscriptions / subscription_packages:
//   per_credit_price = package.price_cents / sum(included_credits)
// All credit types in a package share the same per-credit price.
// (Slight understatement of full-day liability vs half-day in mixed
// packages, but the GL stays balanced because the same price flows
// through purchase, consumption, expiration symmetrically.)
//
// Per ledger row's `kind`, the JE shape is:
//
//   purchase:
//     Debit  Undeposited Funds                (total purchase price)
//     Credit Deferred Revenue (per type)      (count × per-credit price)
//
//   consumption:
//     Debit  Deferred Revenue (per type)      (count × per-credit price)
//     Credit Service Income                   (total)
//
//   expiration:
//     Debit  Deferred Revenue (per type)
//     Credit Expired Credits Income (or fallback Service Income)
//
//   refund:
//     Debit  Deferred Revenue (per type)
//     Credit Undeposited Funds                (cash returned)
//
//   opening_balance / manual_adjustment: SKIPPED. Operator-side
//   only — no canonical accounting treatment.

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

const PICKUP_LIMIT = 50;

type LedgerRow = {
  id: string;
  organization_id: string;
  owner_id: string;
  kind: string;
  delta_full: number;
  delta_half: number;
  delta_nights: number;
  source_purchase_id: string | null;
  reference_id: string | null;
  reference_type: string | null;
  created_at: string;
};

type AccountSettings = {
  default_deposit_account_id: string | null;
  default_income_account_id: string | null;
  default_deferred_daycare_full_account_id: string | null;
  default_deferred_daycare_half_account_id: string | null;
  default_deferred_boarding_account_id: string | null;
  default_expired_credits_income_account_id: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!INTUIT_CLIENT_ID || !INTUIT_CLIENT_SECRET) {
    return json({ error: "QBO not configured" }, 503);
  }

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const isServiceRole =
    (!!SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) ||
    (!!QBO_CRON_SECRET && token === QBO_CRON_SECRET);

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

  // Pull ledger rows that haven't been mapped to QBO yet. Skip
  // opening_balance and manual_adjustment kinds — they have no
  // canonical accounting treatment.
  let ledgerQuery = admin
    .from("credit_ledger")
    .select(
      "id, organization_id, owner_id, kind, delta_full, delta_half, delta_nights, source_purchase_id, reference_id, reference_type, created_at",
    )
    .in("kind", ["purchase", "consumption", "expiration", "refund"])
    .order("created_at", { ascending: true })
    .limit(PICKUP_LIMIT * 2);
  if (orgIdFilter) ledgerQuery = ledgerQuery.eq("organization_id", orgIdFilter);
  const { data: rows, error: rowsErr } = await ledgerQuery;
  if (rowsErr) {
    return json({ error: "Could not list ledger rows", details: rowsErr.message }, 500);
  }
  if (!rows || rows.length === 0) {
    return json({ ok: true, processed: 0, succeeded: 0, failed: 0, skipped: 0 });
  }

  // Filter out already-mapped rows.
  const ids = (rows as LedgerRow[]).map((r) => r.id);
  const { data: existingMaps } = await admin
    .from("quickbooks_entity_mappings")
    .select("snout_id")
    .eq("snout_table", "credit_ledger")
    .eq("qbo_entity_type", "JournalEntry")
    .in("snout_id", ids)
    .is("deleted_at", null);
  const alreadyMapped = new Set(
    (existingMaps ?? []).map((m: any) => m.snout_id),
  );
  const pending = (rows as LedgerRow[])
    .filter((r) => !alreadyMapped.has(r.id))
    .slice(0, PICKUP_LIMIT);

  if (pending.length === 0) {
    return json({ ok: true, processed: 0, succeeded: 0, failed: 0, skipped: 0 });
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const failures: Array<{ id: string; reason: string }> = [];
  const tokenCache = new Map<string, QboTokenContext | null>();
  const accountCache = new Map<string, AccountSettings | null>();
  // Cache the resolved per-credit price keyed by purchase ledger id.
  const priceCache = new Map<string, number>();

  for (const r of pending) {
    try {
      let ctx = tokenCache.get(r.organization_id);
      if (ctx === undefined) {
        ctx = await getTokenContext({
          admin,
          orgId: r.organization_id,
          clientId: INTUIT_CLIENT_ID,
          clientSecret: INTUIT_CLIENT_SECRET,
        });
        tokenCache.set(r.organization_id, ctx);
      }
      if (!ctx) {
        failed += 1;
        failures.push({ id: r.id, reason: "QBO not connected" });
        continue;
      }

      let settings = accountCache.get(r.organization_id);
      if (settings === undefined) {
        const { data: acct } = await admin
          .from("quickbooks_accounts")
          .select(
            "default_deposit_account_id, default_income_account_id, default_deferred_daycare_full_account_id, default_deferred_daycare_half_account_id, default_deferred_boarding_account_id, default_expired_credits_income_account_id",
          )
          .eq("organization_id", r.organization_id)
          .is("deleted_at", null)
          .maybeSingle();
        settings = (acct ?? null) as AccountSettings | null;
        accountCache.set(r.organization_id, settings);
      }
      if (!settings) {
        failed += 1;
        failures.push({ id: r.id, reason: "QBO not configured" });
        continue;
      }

      // Resolve the source purchase to derive per-credit price. For
      // purchase rows, the source IS this row. For consumption /
      // expiration / refund, follow source_purchase_id.
      const purchaseId =
        r.kind === "purchase" ? r.id : r.source_purchase_id;
      if (!purchaseId) {
        skipped += 1;
        continue;
      }
      let perCreditPrice = priceCache.get(purchaseId);
      if (perCreditPrice === undefined) {
        perCreditPrice = await resolvePerCreditPrice(admin, purchaseId);
        priceCache.set(purchaseId, perCreditPrice);
      }
      if (perCreditPrice <= 0) {
        // Couldn't derive a price (no linked subscription_package, or
        // total credits = 0). Skip silently — operator-side gift
        // credits or seed data fall here.
        skipped += 1;
        continue;
      }

      // Compute per-type amounts in cents. `delta_*` is signed: positive
      // for purchase, negative for consumption / expiration / refund.
      const fullCents = Math.abs(r.delta_full) * perCreditPrice;
      const halfCents = Math.abs(r.delta_half) * perCreditPrice;
      const nightsCents = Math.abs(r.delta_nights) * perCreditPrice;
      const totalCents = fullCents + halfCents + nightsCents;
      if (totalCents <= 0) {
        skipped += 1;
        continue;
      }

      const lines = buildJournalLines(r.kind, settings, {
        fullCents,
        halfCents,
        nightsCents,
        totalCents,
      });
      if (!lines.ok) {
        failed += 1;
        failures.push({ id: r.id, reason: lines.error });
        continue;
      }

      const input: QboJournalEntryInput = {
        Line: lines.lines,
        TxnDate: r.created_at.slice(0, 10),
        PrivateNote: `Snout credit ${r.kind} — ledger ${r.id.slice(0, 8)}`,
      };

      const result = await createJournalEntry(ctx, input);
      if (!result.ok) {
        failed += 1;
        failures.push({ id: r.id, reason: result.error });
        continue;
      }

      const je = result.data.JournalEntry;
      await admin.from("quickbooks_entity_mappings").insert({
        organization_id: r.organization_id,
        snout_table: "credit_ledger",
        snout_id: r.id,
        qbo_entity_type: "JournalEntry",
        qbo_id: je.Id,
        sync_token: je.SyncToken,
        sync_state: "synced",
        last_synced_at: new Date().toISOString(),
      });
      succeeded += 1;
    } catch (e) {
      failed += 1;
      failures.push({ id: r.id, reason: (e as Error).message });
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

// Walk: purchase row -> reference_id (uuid) -> owner_subscription ->
// subscription_package -> price_cents and included_credits. Returns
// price-per-credit in cents, or 0 if not derivable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolvePerCreditPrice(admin: any, purchaseId: string): Promise<number> {
  const { data: purchase } = await admin
    .from("credit_ledger")
    .select("reference_id, reference_type, delta_full, delta_half, delta_nights")
    .eq("id", purchaseId)
    .maybeSingle();
  if (!purchase?.reference_id) {
    return 0;
  }
  const { data: sub } = await admin
    .from("owner_subscriptions")
    .select("package_id")
    .eq("id", purchase.reference_id)
    .maybeSingle();
  if (!sub?.package_id) return 0;
  const { data: pkg } = await admin
    .from("subscription_packages")
    .select("price_cents, included_credits")
    .eq("id", sub.package_id)
    .maybeSingle();
  if (!pkg?.price_cents) return 0;
  const included = pkg.included_credits as Record<string, number> | null;
  const totalCredits = included
    ? Object.values(included).reduce((s: number, n: number) => s + (Number(n) || 0), 0)
    : 0;
  if (totalCredits <= 0) return 0;
  return Math.floor(pkg.price_cents / totalCredits);
}

type LineBuildResult =
  | { ok: true; lines: QboJournalEntryLine[] }
  | { ok: false; error: string };

function buildJournalLines(
  kind: string,
  s: AccountSettings,
  amounts: {
    fullCents: number;
    halfCents: number;
    nightsCents: number;
    totalCents: number;
  },
): LineBuildResult {
  const debits: QboJournalEntryLine[] = [];
  const credits: QboJournalEntryLine[] = [];

  const totalDollars = Number((amounts.totalCents / 100).toFixed(2));
  const fullDollars = Number((amounts.fullCents / 100).toFixed(2));
  const halfDollars = Number((amounts.halfCents / 100).toFixed(2));
  const nightsDollars = Number((amounts.nightsCents / 100).toFixed(2));

  // Per-type deferred liability postings. Always one line per non-zero
  // type. Side (Debit vs Credit) flips by kind.
  const deferredFullId = s.default_deferred_daycare_full_account_id;
  const deferredHalfId = s.default_deferred_daycare_half_account_id;
  const deferredBoardId = s.default_deferred_boarding_account_id;

  if (fullDollars > 0 && !deferredFullId) {
    return { ok: false, error: "Daycare Full Day deferred account not selected" };
  }
  if (halfDollars > 0 && !deferredHalfId) {
    return { ok: false, error: "Daycare Half Day deferred account not selected" };
  }
  if (nightsDollars > 0 && !deferredBoardId) {
    return { ok: false, error: "Boarding deferred account not selected" };
  }

  const deferredLines = (side: "Debit" | "Credit"): QboJournalEntryLine[] => {
    const out: QboJournalEntryLine[] = [];
    if (fullDollars > 0) {
      out.push({
        DetailType: "JournalEntryLineDetail",
        Amount: fullDollars,
        Description: `${side} deferred daycare full day`,
        JournalEntryLineDetail: {
          PostingType: side,
          AccountRef: { value: deferredFullId! },
        },
      });
    }
    if (halfDollars > 0) {
      out.push({
        DetailType: "JournalEntryLineDetail",
        Amount: halfDollars,
        Description: `${side} deferred daycare half day`,
        JournalEntryLineDetail: {
          PostingType: side,
          AccountRef: { value: deferredHalfId! },
        },
      });
    }
    if (nightsDollars > 0) {
      out.push({
        DetailType: "JournalEntryLineDetail",
        Amount: nightsDollars,
        Description: `${side} deferred boarding`,
        JournalEntryLineDetail: {
          PostingType: side,
          AccountRef: { value: deferredBoardId! },
        },
      });
    }
    return out;
  };

  if (kind === "purchase") {
    if (!s.default_deposit_account_id) {
      return { ok: false, error: "Source account (Undeposited Funds) not selected" };
    }
    debits.push({
      DetailType: "JournalEntryLineDetail",
      Amount: totalDollars,
      Description: "Credit purchase — cash received",
      JournalEntryLineDetail: {
        PostingType: "Debit",
        AccountRef: { value: s.default_deposit_account_id },
      },
    });
    credits.push(...deferredLines("Credit"));
  } else if (kind === "consumption") {
    if (!s.default_income_account_id) {
      return { ok: false, error: "Income account not selected" };
    }
    debits.push(...deferredLines("Debit"));
    credits.push({
      DetailType: "JournalEntryLineDetail",
      Amount: totalDollars,
      Description: "Credit consumption — revenue recognized",
      JournalEntryLineDetail: {
        PostingType: "Credit",
        AccountRef: { value: s.default_income_account_id },
      },
    });
  } else if (kind === "expiration") {
    // Prefer the operator's expired-credits income account; fall back
    // to general income if they haven't picked one.
    const expiredAcct =
      s.default_expired_credits_income_account_id ?? s.default_income_account_id;
    if (!expiredAcct) {
      return {
        ok: false,
        error: "Expired Credits Income (or fallback Income) account not selected",
      };
    }
    debits.push(...deferredLines("Debit"));
    credits.push({
      DetailType: "JournalEntryLineDetail",
      Amount: totalDollars,
      Description: "Credit expiration — liability released",
      JournalEntryLineDetail: {
        PostingType: "Credit",
        AccountRef: { value: expiredAcct },
      },
    });
  } else if (kind === "refund") {
    if (!s.default_deposit_account_id) {
      return { ok: false, error: "Source account (Undeposited Funds) not selected" };
    }
    debits.push(...deferredLines("Debit"));
    credits.push({
      DetailType: "JournalEntryLineDetail",
      Amount: totalDollars,
      Description: "Credit refund — cash returned",
      JournalEntryLineDetail: {
        PostingType: "Credit",
        AccountRef: { value: s.default_deposit_account_id },
      },
    });
  } else {
    return { ok: false, error: `Unsupported ledger kind: ${kind}` };
  }

  return { ok: true, lines: [...debits, ...credits] };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
