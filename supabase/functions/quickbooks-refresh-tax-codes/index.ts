// Pulls the QuickBooks Online TaxRate + TaxCode catalog into the
// per-org cache (qbo_tax_rates, qbo_tax_codes, qbo_tax_code_rates).
//
// QBO is the source of truth for tax rates; Snout caches them so the
// service-attribution UI has fast lookups and the auto-sync worker
// can compute per-line tax without round-tripping. The cache is fully
// rebuilt on every call: rates and codes are upserted by qbo_id, and
// junction rows are deleted-and-reinserted per code so a TaxCode that
// loses a rate in QBO loses it in Snout too.
//
// Triggered:
//   - Manually from the QuickBooks settings tab via "Refresh tax codes"
//   - One-shot at the end of the OAuth callback (so the operator's
//     first visit to the settings tab already has a populated list)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";
import {
  getTokenContext,
  listTaxCodes,
  listTaxRates,
  type QboTaxCode,
  type QboTaxRate,
} from "../_shared/quickbooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Same fallback pattern as quickbooks-process-queue: Supabase's
// auto-injected SUPABASE_SERVICE_ROLE_KEY can drift from the vault's
// stored service_role_key after key rotations. Accepting either is
// the simplest way to keep server-side invocations working.
const QBO_CRON_SECRET = Deno.env.get("QBO_CRON_SECRET");
const INTUIT_CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID");
const INTUIT_CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!INTUIT_CLIENT_ID || !INTUIT_CLIENT_SECRET) {
      return json({ error: "QuickBooks integration is not configured" }, 503);
    }

    // Two invocation modes:
    //   1. Operator-driven: bearer is a user JWT; resolve org via membership.
    //   2. Server-driven (OAuth callback or SQL pg_net): bearer is the
    //      Supabase service role key; org_id arrives in the JSON body.
    // Mode (2) is required so the OAuth-callback can prime the tax cache
    // immediately after a fresh connect, before the operator clicks
    // anything.
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const isServiceRole =
      (!!SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) ||
      (!!QBO_CRON_SECRET && token === QBO_CRON_SECRET);

    let orgId: string | null = null;
    if (isServiceRole) {
      const body = await req.json().catch(() => ({}));
      orgId = typeof body?.org_id === "string" ? body.org_id : null;
      if (!orgId) {
        return json({ error: "org_id is required for service-role invocation" }, 400);
      }
    } else {
      const ctx = await requireOrgAdmin(req);
      if (!ctx) return json({ error: "Unauthorized" }, 401);
      orgId = ctx.orgId;
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const tokens = await getTokenContext({
      admin,
      orgId,
      clientId: INTUIT_CLIENT_ID,
      clientSecret: INTUIT_CLIENT_SECRET,
    });
    if (!tokens) {
      return json({ error: "QuickBooks is not connected for this organization" }, 400);
    }

    // 1. Pull rates first; we need their Snout UUIDs before we can
    // build the code-to-rate junction.
    const ratesRes = await listTaxRates(tokens);
    if (!ratesRes.ok) {
      return json(
        { error: "Could not list TaxRates from QuickBooks", details: ratesRes.error },
        502,
      );
    }
    const codesRes = await listTaxCodes(tokens);
    if (!codesRes.ok) {
      return json(
        { error: "Could not list TaxCodes from QuickBooks", details: codesRes.error },
        502,
      );
    }

    const now = new Date().toISOString();

    // 2. Upsert rates. Convert RateValue (percentage as decimal, e.g. 5
    // for 5%) to integer basis points: 5% = 500 bp. Multiplied by 100
    // to keep integer storage; for sub-percent rates (e.g. 9.975%) we
    // multiply by 1000 to preserve thousandths and divide by 10 in the
    // query helper. Practical Canadian rates fit comfortably in int.
    const rateRows = (ratesRes.data ?? []).map((r: QboTaxRate) => ({
      organization_id: orgId,
      qbo_id: r.Id,
      name: r.Name ?? `Rate ${r.Id}`,
      rate_basis_points: percentToBasisPoints(r.RateValue),
      agency_name: r.AgencyRef?.name ?? null,
      active: r.Active !== false,
      last_synced_at: now,
    }));

    if (rateRows.length > 0) {
      const { error: rateErr } = await admin
        .from("qbo_tax_rates")
        .upsert(rateRows, { onConflict: "organization_id,qbo_id" });
      if (rateErr) {
        return json({ error: "Could not upsert tax rates", details: rateErr.message }, 500);
      }
    }

    // Reload to get Snout UUIDs for the qbo_id values we just upserted.
    const { data: ratesAfter, error: ratesAfterErr } = await admin
      .from("qbo_tax_rates")
      .select("id, qbo_id")
      .eq("organization_id", orgId);
    if (ratesAfterErr) {
      return json(
        { error: "Could not reload tax rates", details: ratesAfterErr.message },
        500,
      );
    }
    const rateIdByQboId = new Map<string, string>();
    for (const r of ratesAfter ?? []) rateIdByQboId.set(r.qbo_id, r.id);

    // 3. Upsert codes (sales group from SalesTaxRateList; same record
    // also covers purchase via the PurchaseTaxRateList in the junction).
    const codeRows = (codesRes.data ?? []).map((c: QboTaxCode) => ({
      organization_id: orgId,
      qbo_id: c.Id,
      name: c.Name ?? `Code ${c.Id}`,
      description: c.Description ?? null,
      taxable: c.Taxable !== false,
      active: c.Active !== false,
      tax_group: "sales" as const,
      last_synced_at: now,
    }));

    if (codeRows.length > 0) {
      const { error: codeErr } = await admin
        .from("qbo_tax_codes")
        .upsert(codeRows, { onConflict: "organization_id,qbo_id" });
      if (codeErr) {
        return json({ error: "Could not upsert tax codes", details: codeErr.message }, 500);
      }
    }

    const { data: codesAfter, error: codesAfterErr } = await admin
      .from("qbo_tax_codes")
      .select("id, qbo_id")
      .eq("organization_id", orgId);
    if (codesAfterErr) {
      return json(
        { error: "Could not reload tax codes", details: codesAfterErr.message },
        500,
      );
    }
    const codeIdByQboId = new Map<string, string>();
    for (const c of codesAfter ?? []) codeIdByQboId.set(c.qbo_id, c.id);

    // 4. Rebuild the junction. Delete every existing junction row for
    // this org first; then insert fresh from the SalesTaxRateList of
    // each code we just imported. Cheaper and more correct than diffing.
    const { error: deleteErr } = await admin
      .from("qbo_tax_code_rates")
      .delete()
      .eq("organization_id", orgId);
    if (deleteErr) {
      return json(
        { error: "Could not reset tax-code-rate junction", details: deleteErr.message },
        500,
      );
    }

    const junctionRows: Array<{
      organization_id: string;
      tax_code_id: string;
      tax_rate_id: string;
      rate_type: string | null;
    }> = [];
    for (const c of codesRes.data ?? []) {
      const codeId = codeIdByQboId.get(c.Id);
      if (!codeId) continue;
      const details = c.SalesTaxRateList?.TaxRateDetail ?? [];
      for (const d of details) {
        const rateId = rateIdByQboId.get(d.TaxRateRef.value);
        if (!rateId) continue;
        junctionRows.push({
          organization_id: orgId,
          tax_code_id: codeId,
          tax_rate_id: rateId,
          rate_type: d.TaxTypeApplicable ?? null,
        });
      }
    }

    if (junctionRows.length > 0) {
      const { error: junctionErr } = await admin
        .from("qbo_tax_code_rates")
        .insert(junctionRows);
      if (junctionErr) {
        return json(
          { error: "Could not insert tax-code-rate junction", details: junctionErr.message },
          500,
        );
      }
    }

    return json({
      ok: true,
      rates_imported: rateRows.length,
      codes_imported: codeRows.length,
      junction_rows: junctionRows.length,
    });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`quickbooks-refresh-tax-codes error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

// Convert QBO's RateValue (percentage as decimal, e.g. 9.975) to an
// integer count of basis points, treating fractional bp as truncation.
// 5     -> 500
// 9.975 -> 998 (we lose the trailing 0.5 bp; acceptable for cents-level
//                billing)
// 13    -> 1300
function percentToBasisPoints(rate: number | null | undefined): number {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return 0;
  return Math.round(rate * 100);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
