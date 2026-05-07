// 6.6b: Sync recorded tips to QBO as Journal Entries.
//
// Tips live on two Snout tables today:
//   - reservations.tip_cents (set at checkout via TipDialog)
//   - grooming_appointments.tip_cents (per-groomer tipping)
//
// For each tipped record without an existing JournalEntry mapping,
// post a JE:
//   Debit  Undeposited Funds          (tip amount)
//   Credit Tips Payable               (tip amount)
// Net: liability grows by the tip amount; cash side already counted
// when the customer's Payment hit Undeposited Funds at sync time.
//
// Why Undeposited Funds as the source: tip cents collected via Stripe
// terminal flow into the same processor batch as the service charge,
// so they're already sitting in Undeposited Funds (where Snout
// Payments default to). For cash tips, the operator can rebook with
// a Journal Entry override later — but the common case is processor.
//
// Idempotent: scoped lookup by snout_table + snout_id +
// qbo_entity_type='JournalEntry' so re-runs skip already-synced tips.

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

type TipRow = {
  table: "reservations" | "grooming_appointments";
  id: string;
  organization_id: string;
  tip_cents: number;
  date: string; // yyyy-mm-dd for the JE TxnDate
  ref_label: string; // human-readable reference for PrivateNote
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

  // Pull tipped reservations + grooming_appointments without JE mapping.
  // Two queries because the unique-index lookup is per-table.
  const tipRows: TipRow[] = [];

  let resQuery = admin
    .from("reservations")
    .select("id, organization_id, tip_cents, end_at")
    .gt("tip_cents", 0)
    .is("deleted_at", null)
    .limit(PICKUP_LIMIT);
  if (orgIdFilter) resQuery = resQuery.eq("organization_id", orgIdFilter);
  const { data: resData } = await resQuery;
  for (const r of resData ?? []) {
    tipRows.push({
      table: "reservations",
      id: r.id,
      organization_id: r.organization_id,
      tip_cents: r.tip_cents ?? 0,
      date: (r.end_at ?? new Date().toISOString()).slice(0, 10),
      ref_label: `reservation ${r.id.slice(0, 8)}`,
    });
  }

  let gaQuery = admin
    .from("grooming_appointments")
    .select("id, organization_id, tip_cents, appointment_date")
    .gt("tip_cents", 0)
    .limit(PICKUP_LIMIT);
  if (orgIdFilter) gaQuery = gaQuery.eq("organization_id", orgIdFilter);
  const { data: gaData } = await gaQuery;
  for (const g of gaData ?? []) {
    tipRows.push({
      table: "grooming_appointments",
      id: g.id,
      organization_id: g.organization_id,
      tip_cents: g.tip_cents ?? 0,
      date: g.appointment_date ?? new Date().toISOString().slice(0, 10),
      ref_label: `grooming appointment ${g.id.slice(0, 8)}`,
    });
  }

  if (tipRows.length === 0) {
    return json({ ok: true, processed: 0, succeeded: 0, failed: 0 });
  }

  // Filter out ones that already have a JournalEntry mapping.
  const ids = tipRows.map((r) => r.id);
  const { data: existingMaps } = await admin
    .from("quickbooks_entity_mappings")
    .select("snout_table, snout_id")
    .in("snout_table", ["reservations", "grooming_appointments"])
    .in("snout_id", ids)
    .eq("qbo_entity_type", "JournalEntry")
    .is("deleted_at", null);
  const alreadyMapped = new Set(
    (existingMaps ?? []).map((m: any) => `${m.snout_table}:${m.snout_id}`),
  );
  const pending = tipRows.filter(
    (r) => !alreadyMapped.has(`${r.table}:${r.id}`),
  );
  if (pending.length === 0) {
    return json({ ok: true, processed: 0, succeeded: 0, failed: 0 });
  }

  let succeeded = 0;
  let failed = 0;
  const failures: Array<{ id: string; reason: string }> = [];
  const tokenCache = new Map<string, QboTokenContext | null>();

  for (const t of pending) {
    try {
      let ctx = tokenCache.get(t.organization_id);
      if (ctx === undefined) {
        ctx = await getTokenContext({
          admin,
          orgId: t.organization_id,
          clientId: INTUIT_CLIENT_ID,
          clientSecret: INTUIT_CLIENT_SECRET,
        });
        tokenCache.set(t.organization_id, ctx);
      }
      if (!ctx) {
        failed += 1;
        failures.push({ id: t.id, reason: "QBO not connected" });
        continue;
      }

      const { data: account } = await admin
        .from("quickbooks_accounts")
        .select(
          "default_deposit_account_id, default_tips_payable_account_id, default_tips_payable_account_name",
        )
        .eq("organization_id", t.organization_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!account?.default_tips_payable_account_id) {
        failed += 1;
        failures.push({
          id: t.id,
          reason:
            "No Tips Payable account selected. Pick one from the QuickBooks settings tab.",
        });
        continue;
      }
      if (!account?.default_deposit_account_id) {
        failed += 1;
        failures.push({
          id: t.id,
          reason:
            "No source account selected (Undeposited Funds). Pick one from the QuickBooks settings tab.",
        });
        continue;
      }

      const tipDollars = Number((t.tip_cents / 100).toFixed(2));
      const lines: QboJournalEntryLine[] = [
        {
          DetailType: "JournalEntryLineDetail",
          Amount: tipDollars,
          Description: `Tip — ${t.ref_label}`,
          JournalEntryLineDetail: {
            PostingType: "Debit",
            AccountRef: { value: account.default_deposit_account_id },
          },
        },
        {
          DetailType: "JournalEntryLineDetail",
          Amount: tipDollars,
          Description: `Tip payable — ${t.ref_label}`,
          JournalEntryLineDetail: {
            PostingType: "Credit",
            AccountRef: { value: account.default_tips_payable_account_id },
          },
        },
      ];

      const input: QboJournalEntryInput = {
        Line: lines,
        TxnDate: t.date,
        PrivateNote: `Snout tip — ${t.ref_label}`,
      };

      const result = await createJournalEntry(ctx, input);
      if (!result.ok) {
        failed += 1;
        failures.push({ id: t.id, reason: result.error });
        continue;
      }

      const je = result.data.JournalEntry;
      await admin.from("quickbooks_entity_mappings").insert({
        organization_id: t.organization_id,
        snout_table: t.table,
        snout_id: t.id,
        qbo_entity_type: "JournalEntry",
        qbo_id: je.Id,
        sync_token: je.SyncToken,
        sync_state: "synced",
        last_synced_at: new Date().toISOString(),
      });
      succeeded += 1;
    } catch (e) {
      failed += 1;
      failures.push({ id: t.id, reason: (e as Error).message });
    }
  }

  return json({
    ok: true,
    processed: pending.length,
    succeeded,
    failed,
    failures: failures.slice(0, 20),
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
