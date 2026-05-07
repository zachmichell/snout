// Auto-sync worker. Pulled by pg_cron every minute. Drains the
// quickbooks_sync_queue: for each due entity, calls the same
// per-entity sync helper the manual flows use. Idempotent end-to-end:
// repeat invocations with no work return { processed: 0 }.
//
// Auth: service-role only. The cron job retrieves the service role
// key from Vault and posts it as a Bearer token. Manual invocation
// is also possible from a curl with the service-role key (useful for
// debugging without waiting for the next cron tick).
//
// Per-tick budget: 50 entities. With ~130ms per QBO write plus
// per-row mapping I/O, that's roughly 8-10 seconds per tick. Keeps
// us comfortably under the edge function timeout and within Intuit's
// 500/min realm rate limit when summed with any concurrent manual
// syncs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  createCustomer,
  createInvoice,
  createItem,
  createPayment,
  createRefundReceipt,
  findCustomerByDisplayName,
  findInvoiceByDocNumber,
  findItemByName,
  findPaymentByRefNum,
  findRefundReceiptByRefNum,
  getTokenContext,
  listDepositAccounts,
  listIncomeAccounts,
  syncOneEntity,
  updateCustomer,
  updateInvoice,
  updateItem,
  updatePayment,
  updateRefundReceipt,
  type QboCustomerInput,
  type QboInvoiceInput,
  type QboInvoiceLine,
  type QboItemInput,
  type QboPaymentInput,
  type QboRefundReceiptInput,
  type QboTokenContext,
} from "../_shared/quickbooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Optional explicit cron secret. Lets the operator decouple this
// function's auth from Supabase's auto-injected SUPABASE_SERVICE_ROLE_KEY,
// which has been seen to drift from the dashboard's current key on
// some projects after key rotations or new-format-key migrations.
// When set, the worker accepts a bearer token equal to either env var.
const QBO_CRON_SECRET = Deno.env.get("QBO_CRON_SECRET");
const INTUIT_CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID");
const INTUIT_CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET");

const PICKUP_LIMIT = 50;
const INTRA_BATCH_DELAY_MS = 130;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Service-role gate: only the cron tick or a debugging service-role
  // invocation should be able to fire this. We compare the bearer
  // token against the auto-injected service-role key OR an explicit
  // QBO_CRON_SECRET. The two-key fallback exists because Supabase's
  // SUPABASE_SERVICE_ROLE_KEY auto-injection has been seen to lag
  // behind the dashboard's current key on some projects.
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const matchesServiceRole =
    !!SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY;
  const matchesCronSecret = !!QBO_CRON_SECRET && token === QBO_CRON_SECRET;
  if (!token || (!matchesServiceRole && !matchesCronSecret)) {
    return json({ error: "Forbidden" }, 403);
  }

  if (!INTUIT_CLIENT_ID || !INTUIT_CLIENT_SECRET) {
    return json({ ok: true, processed: 0, reason: "qbo_not_configured" });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Pickup batch via the SQL helper that coalesces older duplicates.
  const { data: due, error: pickupErr } = await admin.rpc("qbo_pickup_queue_batch", {
    _limit: PICKUP_LIMIT,
  });
  if (pickupErr) {
    console.error("qbo_pickup_queue_batch failed:", pickupErr);
    return json({ ok: false, error: pickupErr.message }, 500);
  }
  const rows =
    (due ?? []) as Array<{
      id: string;
      organization_id: string;
      snout_table: string;
      snout_id: string;
      op: string;
      attempts: number;
    }>;
  if (rows.length === 0) {
    return json({ ok: true, processed: 0 });
  }

  // Cache token contexts and per-org income accounts (for items) so
  // we don't refresh tokens or query QBO accounts repeatedly when
  // multiple entities for the same org are in the same batch.
  const tokenCache = new Map<string, QboTokenContext | null>();
  const incomeAccountCache = new Map<string, { value: string; name: string } | null>();
  const depositAccountCache = new Map<string, { value: string; name: string } | null>();

  let succeeded = 0;
  let failed = 0;
  let processedRowCount = 0;

  for (const row of rows) {
    if (processedRowCount > 0) await sleep(INTRA_BATCH_DELAY_MS);
    processedRowCount += 1;

    try {
      // Resolve token for this org (cache hit avoids redundant refresh).
      let ctx = tokenCache.get(row.organization_id);
      if (ctx === undefined) {
        ctx = await getTokenContext({
          admin,
          orgId: row.organization_id,
          clientId: INTUIT_CLIENT_ID,
          clientSecret: INTUIT_CLIENT_SECRET,
        });
        tokenCache.set(row.organization_id, ctx);
      }
      if (!ctx) {
        await admin.rpc("qbo_mark_queue_failed", {
          _id: row.id,
          _error: "Org has no active QBO connection",
        });
        failed += 1;
        continue;
      }

      // Dispatch by table.
      if (row.snout_table === "owners") {
        const result = await syncOwner(admin, ctx, row.organization_id, row.snout_id);
        if (result.ok) {
          await admin.rpc("qbo_mark_queue_processed", { _id: row.id });
          succeeded += 1;
        } else {
          await admin.rpc("qbo_mark_queue_failed", { _id: row.id, _error: result.error });
          failed += 1;
        }
      } else if (row.snout_table === "invoices") {
        const result = await syncInvoice(admin, ctx, row.organization_id, row.snout_id);
        if (result.ok) {
          await admin.rpc("qbo_mark_queue_processed", { _id: row.id });
          succeeded += 1;
        } else {
          await admin.rpc("qbo_mark_queue_failed", { _id: row.id, _error: result.error });
          failed += 1;
        }
      } else if (row.snout_table === "payments") {
        // Deposit account is OPTIONAL on QBO Payment. QBO's default is
        // "Undeposited Funds"; omitting the field sends payments there
        // automatically. We still try to discover and persist a
        // preferred account so future invocations don't re-query, but
        // a discovery failure is no longer fatal.
        let depositAccount = depositAccountCache.get(row.organization_id);
        if (depositAccount === undefined) {
          depositAccount = await ensureDepositAccount(admin, row.organization_id, ctx);
          depositAccountCache.set(row.organization_id, depositAccount);
        }
        // First leg: ensure the QBO Payment exists (idempotent).
        // Refunded payments still need their original Payment in QBO
        // so the original Invoice stays paid; only after that succeeds
        // do we add the RefundReceipt.
        const paymentResult = await syncPayment(
          admin,
          ctx,
          row.organization_id,
          row.snout_id,
          depositAccount,
        );
        if (!paymentResult.ok) {
          await admin.rpc("qbo_mark_queue_failed", { _id: row.id, _error: paymentResult.error });
          failed += 1;
          continue;
        }

        // Second leg: when the Snout payment is refunded, also create a
        // QBO RefundReceipt. syncRefundReceipt is a no-op for non-
        // refunded payments so the call is safe to make every time.
        const refundResult = await syncRefundReceipt(
          admin,
          ctx,
          row.organization_id,
          row.snout_id,
          depositAccount,
        );
        if (!refundResult.ok) {
          await admin.rpc("qbo_mark_queue_failed", { _id: row.id, _error: refundResult.error });
          failed += 1;
          continue;
        }

        await admin.rpc("qbo_mark_queue_processed", { _id: row.id });
        succeeded += 1;
      } else if (row.snout_table === "services") {
        // Items also need an income account; resolve once per org.
        let incomeAccount = incomeAccountCache.get(row.organization_id);
        if (incomeAccount === undefined) {
          incomeAccount = await ensureIncomeAccount(admin, row.organization_id, ctx);
          incomeAccountCache.set(row.organization_id, incomeAccount);
        }
        if (!incomeAccount) {
          await admin.rpc("qbo_mark_queue_failed", {
            _id: row.id,
            _error: "No active Income account in QBO",
          });
          failed += 1;
          continue;
        }
        const result = await syncService(
          admin,
          ctx,
          row.organization_id,
          row.snout_id,
          incomeAccount,
        );
        if (result.ok) {
          await admin.rpc("qbo_mark_queue_processed", { _id: row.id });
          succeeded += 1;
        } else {
          await admin.rpc("qbo_mark_queue_failed", { _id: row.id, _error: result.error });
          failed += 1;
        }
      } else {
        // Future entity types (invoices, payments) land here in 6.3 / 6.4.
        await admin.rpc("qbo_mark_queue_failed", {
          _id: row.id,
          _error: `Unknown snout_table: ${row.snout_table}`,
        });
        failed += 1;
      }
    } catch (e) {
      await admin.rpc("qbo_mark_queue_failed", {
        _id: row.id,
        _error: e instanceof Error ? e.message : String(e),
      });
      failed += 1;
    }
  }

  return json({ ok: true, processed: rows.length, succeeded, failed });
});

async function syncOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  ctx: QboTokenContext,
  orgId: string,
  ownerId: string,
) {
  const { data: owner } = await admin
    .from("owners")
    .select(
      "id, first_name, last_name, email, phone, street_address, city, state_province, postal_code, notes, deleted_at",
    )
    .eq("id", ownerId)
    .maybeSingle();
  if (!owner) return { ok: false, error: "Owner not found" };
  // Soft-deleted: skip the QBO write. Future patch may deactivate
  // the QBO Customer; for now we leave it as-is.
  if (owner.deleted_at) {
    return { ok: true as const, state: "unchanged" as const, qboId: "" };
  }

  const input = ownerToCustomerInput(owner);
  return syncOneEntity({
    admin,
    orgId,
    snoutTable: "owners",
    snoutId: ownerId,
    qboEntityType: "Customer",
    payload: input,
    create: () => createCustomer(ctx, input),
    update: (current) => updateCustomer(ctx, current, input),
    extractIdSyncToken: (data) => {
      const c = "Customer" in (data as Record<string, unknown>) ? (data as { Customer: { Id: string; SyncToken: string } }).Customer : (data as { Id: string; SyncToken: string });
      return { id: c.Id, syncToken: c.SyncToken };
    },
    lookupExistingByName: async () => {
      const r = await findCustomerByDisplayName(ctx, input.DisplayName);
      if (!r.ok) return r;
      return r.data
        ? { ok: true as const, status: r.status, data: { Id: r.data.Id, SyncToken: r.data.SyncToken } }
        : { ok: true as const, status: r.status, data: null };
    },
  });
}

async function syncService(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  ctx: QboTokenContext,
  orgId: string,
  serviceId: string,
  incomeAccount: { value: string; name: string },
) {
  const { data: svc } = await admin
    .from("services")
    .select("id, name, description, base_price_cents, active, deleted_at")
    .eq("id", serviceId)
    .maybeSingle();
  if (!svc) return { ok: false, error: "Service not found" };
  if (svc.deleted_at) {
    return { ok: true as const, state: "unchanged" as const, qboId: "" };
  }

  const input = serviceToItemInput(svc, incomeAccount);
  return syncOneEntity({
    admin,
    orgId,
    snoutTable: "services",
    snoutId: serviceId,
    qboEntityType: "Item",
    payload: input,
    create: () => createItem(ctx, input),
    update: (current) => updateItem(ctx, current, input),
    extractIdSyncToken: (data) => {
      const i = "Item" in (data as Record<string, unknown>) ? (data as { Item: { Id: string; SyncToken: string } }).Item : (data as { Id: string; SyncToken: string });
      return { id: i.Id, syncToken: i.SyncToken };
    },
    lookupExistingByName: async () => {
      const r = await findItemByName(ctx, input.Name);
      if (!r.ok) return r;
      return r.data
        ? { ok: true as const, status: r.status, data: { Id: r.data.Id, SyncToken: r.data.SyncToken } }
        : { ok: true as const, status: r.status, data: null };
    },
  });
}

// Sync one Snout invoice to QuickBooks. Pre-flight requirements:
//   * The owner has a 'synced' mapping (we resolve CustomerRef from it).
//   * Every invoice_line with service_id has a 'synced' mapping for
//     that service (we resolve ItemRef from it). Lines without
//     service_id become DescriptionOnly lines on the QBO invoice
//     (handles surcharges, discounts, tips, ad-hoc additions).
// If any prerequisite isn't met, we fail the invoice with a clear
// "X not yet synced" message. The auto-sync queue's backoff retries
// pick up the invoice once the dependent entities have synced.
//
// Tax handling: GlobalTaxCalculation = TaxExcluded means the lines
// are pre-tax and we set the total tax explicitly on TxnTaxDetail.
// Lines stay at their Snout pre-tax prices; QBO totals match Snout
// because tax flows through the txn-level field. This is path (a)
// from the cluster scope: Snout's authoritative number wins.
//
// Currency: QBO companies are single-currency unless Multicurrency
// is enabled. Snout invoice currency must match the QBO company's
// home currency; mismatch returns a clear error rather than a
// silent type cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncInvoice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  ctx: QboTokenContext,
  orgId: string,
  invoiceId: string,
) {
  const { data: invoice } = await admin
    .from("invoices")
    .select(
      "id, organization_id, owner_id, status, invoice_number, currency, subtotal_cents, tax_cents, total_cents, surcharge_cents, promotion_discount_cents, store_credit_applied_cents, issued_at, due_at, notes, deleted_at",
    )
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { ok: false as const, error: "Invoice not found" };
  if (invoice.deleted_at) {
    return { ok: true as const, state: "unchanged" as const, qboId: "" };
  }
  // Drafts and voided invoices are not pushed to QBO. The trigger
  // already filters draft on enqueue; this is the void guard.
  if (invoice.status === "draft" || invoice.status === "void") {
    return { ok: true as const, state: "unchanged" as const, qboId: "" };
  }
  if (!invoice.owner_id) {
    return { ok: false as const, error: "Invoice has no owner; cannot resolve QBO Customer" };
  }

  // Resolve customer via mapping. If not synced, fail with a message
  // that names the entity type so the operator can find it.
  const { data: ownerMapping } = await admin
    .from("quickbooks_entity_mappings")
    .select("qbo_id, sync_state")
    .eq("organization_id", orgId)
    .eq("snout_table", "owners")
    .eq("snout_id", invoice.owner_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!ownerMapping || ownerMapping.sync_state !== "synced" || !ownerMapping.qbo_id) {
    return {
      ok: false as const,
      error: `Invoice owner (${invoice.owner_id}) is not yet synced to QBO. Will retry once the owner sync completes.`,
    };
  }

  // Pull lines and resolve any service refs. (6.4.5d) qbo_tax_code_id
  // is the per-line override; null falls through to the service's
  // qbo_tax_code_id which we resolve below.
  const { data: lines, error: linesErr } = await admin
    .from("invoice_lines")
    .select(
      "id, service_id, description, quantity, unit_price_cents, line_total_cents, line_type, qbo_tax_code_id",
    )
    .eq("invoice_id", invoiceId)
    .order("created_at");
  if (linesErr) {
    return { ok: false as const, error: `Could not load invoice lines: ${linesErr.message}` };
  }

  // Service id -> mapping + tax code lookup batch.
  const serviceIds = (lines ?? [])
    .map((l: { service_id: string | null }) => l.service_id)
    .filter((id: string | null): id is string => !!id);
  const uniqueServiceIds = Array.from(new Set(serviceIds));
  const serviceMappings: Record<string, { qbo_id: string; sync_state: string }> = {};
  const serviceTaxCodes: Record<string, string | null> = {};
  if (uniqueServiceIds.length > 0) {
    const { data: svcMaps } = await admin
      .from("quickbooks_entity_mappings")
      .select("snout_id, qbo_id, sync_state")
      .eq("organization_id", orgId)
      .eq("snout_table", "services")
      .in("snout_id", uniqueServiceIds)
      .is("deleted_at", null);
    for (const m of svcMaps ?? []) {
      serviceMappings[m.snout_id] = { qbo_id: m.qbo_id, sync_state: m.sync_state };
    }
    const { data: svcRows } = await admin
      .from("services")
      .select("id, qbo_tax_code_id")
      .in("id", uniqueServiceIds);
    for (const s of svcRows ?? []) {
      serviceTaxCodes[s.id] = s.qbo_tax_code_id ?? null;
    }
  }

  // Bail early if any referenced service isn't synced.
  for (const sid of uniqueServiceIds) {
    const m = serviceMappings[sid];
    if (!m || m.sync_state !== "synced" || !m.qbo_id) {
      return {
        ok: false as const,
        error: `Service ${sid} on this invoice is not yet synced to QBO. Will retry once the service sync completes.`,
      };
    }
  }

  // (6.4.5d) Resolve every distinct Snout-side qbo_tax_code_id (line
  // override OR service default) into the QBO TaxCode Id text. We fetch
  // in one batch and put the results in a map keyed by Snout uuid so
  // each line's mapper can resolve in O(1).
  const taxCodeUuids = new Set<string>();
  for (const l of lines ?? []) {
    if (l.qbo_tax_code_id) {
      taxCodeUuids.add(l.qbo_tax_code_id);
    } else if (l.service_id && serviceTaxCodes[l.service_id]) {
      taxCodeUuids.add(serviceTaxCodes[l.service_id] as string);
    }
  }
  const taxCodeQboIds: Record<string, string> = {};
  if (taxCodeUuids.size > 0) {
    const { data: codes } = await admin
      .from("qbo_tax_codes")
      .select("id, qbo_id")
      .in("id", Array.from(taxCodeUuids));
    for (const c of codes ?? []) {
      taxCodeQboIds[c.id] = c.qbo_id;
    }
  }

  function resolveLineTaxCodeRef(
    line: { service_id: string | null; qbo_tax_code_id: string | null },
  ): { value: string } | undefined {
    const uuid = line.qbo_tax_code_id ?? (line.service_id ? serviceTaxCodes[line.service_id] : null);
    if (!uuid) return undefined;
    const qboId = taxCodeQboIds[uuid];
    return qboId ? { value: qboId } : undefined;
  }

  // Build line items. Cents -> dollars for QBO's decimal Amount.
  const qboLines: QboInvoiceLine[] = (lines ?? []).map((l: {
    service_id: string | null;
    description: string;
    quantity: number | string;
    unit_price_cents: number;
    line_total_cents: number;
    qbo_tax_code_id: string | null;
  }) => {
    const lineTotal = Number((l.line_total_cents / 100).toFixed(2));
    const unitPrice = Number((l.unit_price_cents / 100).toFixed(2));
    const qty = typeof l.quantity === "string" ? parseFloat(l.quantity) : l.quantity;
    const taxCodeRef = resolveLineTaxCodeRef(l);

    if (l.service_id && serviceMappings[l.service_id]) {
      const m = serviceMappings[l.service_id];
      return {
        DetailType: "SalesItemLineDetail" as const,
        Amount: lineTotal,
        Description: l.description,
        SalesItemLineDetail: {
          ItemRef: { value: m.qbo_id },
          Qty: qty,
          UnitPrice: unitPrice,
          ...(taxCodeRef ? { TaxCodeRef: taxCodeRef } : {}),
        },
      };
    }
    // Surcharges, discounts, tips, ad-hoc lines: description-only with
    // an Amount. QBO permits negative amounts here for discounts.
    return {
      DetailType: "DescriptionOnly" as const,
      Amount: lineTotal,
      Description: l.description,
    };
  });

  // (6.4.5d) Build invoice payload. We no longer override TxnTaxDetail
  // .TotalTax: in QBO Canada (Automated Sales Tax mode) the field is
  // ignored unless paired with a TxnTaxCodeRef and matching TaxLine
  // entries. Instead, every taxable line carries its own TaxCodeRef
  // and QBO computes the total from those. Snout's authoritative
  // tax_cents stays correct because both sides derive from the same
  // per-service tax-code attribution.
  //
  // GlobalTaxCalculation = TaxExcluded says "line UnitPrice/Amount are
  // pre-tax, please add tax on top." NotApplicable disables AST in
  // companies that haven't configured it. We keep both legs.
  const input: QboInvoiceInput = {
    CustomerRef: { value: ownerMapping.qbo_id },
    Line: qboLines,
    DocNumber: invoice.invoice_number ?? invoice.id.slice(0, 8),
    PrivateNote: invoice.notes ?? undefined,
    GlobalTaxCalculation: invoice.tax_cents > 0 ? "TaxExcluded" : "NotApplicable",
    CurrencyRef: { value: invoice.currency as "CAD" | "USD" },
  };
  if (invoice.issued_at) {
    input.TxnDate = invoice.issued_at.slice(0, 10);
  }
  if (invoice.due_at) {
    input.DueDate = invoice.due_at.slice(0, 10);
  }

  return syncOneEntity({
    admin,
    orgId,
    snoutTable: "invoices",
    snoutId: invoiceId,
    qboEntityType: "Invoice",
    payload: input,
    create: () => createInvoice(ctx, input),
    update: (current) => updateInvoice(ctx, current, input),
    extractIdSyncToken: (data) => {
      const i = "Invoice" in (data as Record<string, unknown>)
        ? (data as { Invoice: { Id: string; SyncToken: string } }).Invoice
        : (data as { Id: string; SyncToken: string });
      return { id: i.Id, syncToken: i.SyncToken };
    },
    lookupExistingByName: input.DocNumber
      ? async () => {
          const r = await findInvoiceByDocNumber(ctx, input.DocNumber!);
          if (!r.ok) return r;
          return r.data
            ? { ok: true as const, status: r.status, data: { Id: r.data.Id, SyncToken: r.data.SyncToken } }
            : { ok: true as const, status: r.status, data: null };
        }
      : undefined,
  });
}

// Sync one Snout payment to QuickBooks as a Payment entity linked to
// the corresponding invoice. Pre-flight: invoice must already be
// synced (so we can use its QBO Invoice Id as the LinkedTxn target),
// and via the invoice the owner mapping is already in place too.
//
// Refunds (status='refunded') are out of scope for 6.4 and skip with
// a no-op until 6.4b lands the RefundReceipt flow.
async function syncPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  ctx: QboTokenContext,
  orgId: string,
  paymentId: string,
  depositAccount: { value: string; name: string } | null,
) {
  const { data: payment } = await admin
    .from("payments")
    .select(
      "id, organization_id, invoice_id, amount_cents, currency, method, status, stripe_payment_intent_id, helcim_transaction_id, processed_at, deleted_at, refund_reason_id",
    )
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return { ok: false as const, error: "Payment not found" };
  if (payment.deleted_at) {
    return { ok: true as const, state: "unchanged" as const, qboId: "" };
  }
  if (payment.status === "pending" || payment.status === "failed") {
    return { ok: true as const, state: "unchanged" as const, qboId: "" };
  }
  // 6.4b: refunded payments still need their original Payment in QBO
  // so the original Invoice stays paid; the syncRefundReceipt second
  // leg adds the RefundReceipt entity for the refund itself. Both
  // 'succeeded' and 'refunded' fall through here unchanged.
  if (payment.status !== "succeeded" && payment.status !== "refunded") {
    return { ok: false as const, error: `Unexpected payment status: ${payment.status}` };
  }

  // Resolve the invoice (and through it the customer) via mappings.
  const { data: invoice } = await admin
    .from("invoices")
    .select("id, owner_id")
    .eq("id", payment.invoice_id)
    .maybeSingle();
  if (!invoice) return { ok: false as const, error: "Payment's invoice not found" };

  const { data: invoiceMapping } = await admin
    .from("quickbooks_entity_mappings")
    .select("qbo_id, sync_state")
    .eq("organization_id", orgId)
    .eq("snout_table", "invoices")
    .eq("snout_id", payment.invoice_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!invoiceMapping || invoiceMapping.sync_state !== "synced" || !invoiceMapping.qbo_id) {
    return {
      ok: false as const,
      error: `Payment's invoice (${payment.invoice_id}) is not yet synced to QBO. Will retry once the invoice sync completes.`,
    };
  }

  const { data: ownerMapping } = await admin
    .from("quickbooks_entity_mappings")
    .select("qbo_id, sync_state")
    .eq("organization_id", orgId)
    .eq("snout_table", "owners")
    .eq("snout_id", invoice.owner_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!ownerMapping || ownerMapping.sync_state !== "synced" || !ownerMapping.qbo_id) {
    return {
      ok: false as const,
      error: `Payment's owner (${invoice.owner_id}) is not yet synced to QBO. Will retry once the owner sync completes.`,
    };
  }

  const amountDollars = Number((payment.amount_cents / 100).toFixed(2));
  // Prefer Stripe payment-intent id over Helcim transaction id when
  // both are present (only one ever should be).
  const refNum =
    payment.stripe_payment_intent_id ?? payment.helcim_transaction_id ?? payment.id.slice(0, 21);
  // QBO PaymentRefNum cap at 21 chars; truncate defensively.
  const truncatedRef = refNum.slice(0, 21);

  const input: QboPaymentInput = {
    CustomerRef: { value: ownerMapping.qbo_id },
    TotalAmt: amountDollars,
    Line: [
      {
        Amount: amountDollars,
        LinkedTxn: [{ TxnId: invoiceMapping.qbo_id, TxnType: "Invoice" }],
      },
    ],
    PaymentRefNum: truncatedRef,
    CurrencyRef: { value: payment.currency as "CAD" | "USD" },
  };
  // Only include DepositToAccountRef when we discovered one; QBO's
  // own default ("Undeposited Funds") kicks in otherwise.
  if (depositAccount) {
    input.DepositToAccountRef = depositAccount;
  }
  if (payment.processed_at) {
    input.TxnDate = payment.processed_at.slice(0, 10);
  }

  return syncOneEntity({
    admin,
    orgId,
    snoutTable: "payments",
    snoutId: paymentId,
    qboEntityType: "Payment",
    payload: input,
    create: () => createPayment(ctx, input),
    update: (current) => updatePayment(ctx, current, input),
    extractIdSyncToken: (data) => {
      const p = "Payment" in (data as Record<string, unknown>)
        ? (data as { Payment: { Id: string; SyncToken: string } }).Payment
        : (data as { Id: string; SyncToken: string });
      return { id: p.Id, syncToken: p.SyncToken };
    },
    lookupExistingByName: input.PaymentRefNum
      ? async () => {
          const r = await findPaymentByRefNum(ctx, input.PaymentRefNum!);
          if (!r.ok) return r;
          return r.data
            ? { ok: true as const, status: r.status, data: { Id: r.data.Id, SyncToken: r.data.SyncToken } }
            : { ok: true as const, status: r.status, data: null };
        }
      : undefined,
  });
}

// 6.4b: For refunded payments, create the QBO RefundReceipt that
// records the money returned to the customer. The original Payment
// stays untouched on QBO so the original Invoice continues to show
// "Paid". Per operator decision:
//   - Full refund (refund_amount == original payment): mirror the
//     original invoice's lines exactly, so each line reverses against
//     the same income account it credited.
//   - Partial refund: a single description-only line ("Partial refund
//     of payment <ref>") for the refund amount, without per-line
//     proration.
// No-op for non-refunded payments so the worker can call this
// unconditionally on the payments branch.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncRefundReceipt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  ctx: QboTokenContext,
  orgId: string,
  paymentId: string,
  depositAccount: { value: string; name: string } | null,
) {
  const { data: payment } = await admin
    .from("payments")
    .select(
      "id, invoice_id, amount_cents, currency, status, stripe_payment_intent_id, helcim_transaction_id, processed_at, deleted_at, refund_amount_cents",
    )
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment || payment.deleted_at || payment.status !== "refunded") {
    return { ok: true as const, state: "unchanged" as const, qboId: "" };
  }

  // Resolve invoice + owner mappings (needed for CustomerRef + line
  // ItemRefs on full-refund mirror).
  const { data: invoice } = await admin
    .from("invoices")
    .select("id, owner_id, total_cents")
    .eq("id", payment.invoice_id)
    .maybeSingle();
  if (!invoice) {
    return { ok: false as const, error: "Refund's invoice not found" };
  }

  const { data: ownerMapping } = await admin
    .from("quickbooks_entity_mappings")
    .select("qbo_id, sync_state")
    .eq("organization_id", orgId)
    .eq("snout_table", "owners")
    .eq("snout_id", invoice.owner_id)
    .eq("qbo_entity_type", "Customer")
    .is("deleted_at", null)
    .maybeSingle();
  if (!ownerMapping || ownerMapping.sync_state !== "synced" || !ownerMapping.qbo_id) {
    return {
      ok: false as const,
      error: `Refund's owner (${invoice.owner_id}) is not yet synced to QBO. Will retry once the owner sync completes.`,
    };
  }

  // refund_amount_cents is the actual refunded amount; if absent we
  // assume the operator refunded the full payment.
  const refundAmountCents = payment.refund_amount_cents ?? payment.amount_cents;
  const isFullRefund = refundAmountCents >= payment.amount_cents;
  const refundAmountDollars = Number((refundAmountCents / 100).toFixed(2));

  // Build the line items.
  let lines: Array<
    | {
        DetailType: "SalesItemLineDetail";
        Amount: number;
        Description?: string;
        SalesItemLineDetail: {
          ItemRef: { value: string; name?: string };
          Qty?: number;
          UnitPrice?: number;
          TaxCodeRef?: { value: string };
        };
      }
    | { DetailType: "DescriptionOnly"; Amount?: number; Description: string }
  > = [];

  if (isFullRefund) {
    // Mirror the original invoice's lines so each one reverses the
    // exact income / tax routing that booked the original revenue.
    const { data: invLines } = await admin
      .from("invoice_lines")
      .select(
        "id, service_id, description, quantity, unit_price_cents, line_total_cents, qbo_tax_code_id",
      )
      .eq("invoice_id", payment.invoice_id)
      .order("created_at");

    // Resolve service mappings (Item refs) and tax-code refs (TaxCodeRef).
    const serviceIds = (invLines ?? [])
      .map((l: { service_id: string | null }) => l.service_id)
      .filter((id: string | null): id is string => !!id);
    const uniqueServiceIds = Array.from(new Set(serviceIds));
    const serviceMap: Record<string, string> = {};
    if (uniqueServiceIds.length > 0) {
      const { data: svcMaps } = await admin
        .from("quickbooks_entity_mappings")
        .select("snout_id, qbo_id")
        .eq("organization_id", orgId)
        .eq("snout_table", "services")
        .eq("qbo_entity_type", "Item")
        .in("snout_id", uniqueServiceIds)
        .is("deleted_at", null);
      for (const m of svcMaps ?? []) serviceMap[m.snout_id] = m.qbo_id;
    }
    const serviceTaxCodes: Record<string, string | null> = {};
    if (uniqueServiceIds.length > 0) {
      const { data: svcRows } = await admin
        .from("services")
        .select("id, qbo_tax_code_id")
        .in("id", uniqueServiceIds);
      for (const s of svcRows ?? []) serviceTaxCodes[s.id] = s.qbo_tax_code_id ?? null;
    }
    const taxCodeUuids = new Set<string>();
    for (const l of invLines ?? []) {
      if (l.qbo_tax_code_id) taxCodeUuids.add(l.qbo_tax_code_id);
      else if (l.service_id && serviceTaxCodes[l.service_id])
        taxCodeUuids.add(serviceTaxCodes[l.service_id] as string);
    }
    const taxCodeQboIds: Record<string, string> = {};
    if (taxCodeUuids.size > 0) {
      const { data: codes } = await admin
        .from("qbo_tax_codes")
        .select("id, qbo_id")
        .in("id", Array.from(taxCodeUuids));
      for (const c of codes ?? []) taxCodeQboIds[c.id] = c.qbo_id;
    }

    for (const l of invLines ?? []) {
      const lineTotal = Number((l.line_total_cents / 100).toFixed(2));
      const unitPrice = Number((l.unit_price_cents / 100).toFixed(2));
      const qty = typeof l.quantity === "string" ? parseFloat(l.quantity) : l.quantity;
      const effectiveTaxCodeUuid =
        l.qbo_tax_code_id ?? (l.service_id ? serviceTaxCodes[l.service_id] : null);
      const taxCodeRef = effectiveTaxCodeUuid && taxCodeQboIds[effectiveTaxCodeUuid]
        ? { value: taxCodeQboIds[effectiveTaxCodeUuid] }
        : undefined;

      if (l.service_id && serviceMap[l.service_id]) {
        lines.push({
          DetailType: "SalesItemLineDetail" as const,
          Amount: lineTotal,
          Description: l.description,
          SalesItemLineDetail: {
            ItemRef: { value: serviceMap[l.service_id] },
            Qty: qty,
            UnitPrice: unitPrice,
            ...(taxCodeRef ? { TaxCodeRef: taxCodeRef } : {}),
          },
        });
      } else {
        lines.push({
          DetailType: "DescriptionOnly" as const,
          Amount: lineTotal,
          Description: l.description,
        });
      }
    }
  } else {
    // Partial refund: single description-only line. Operator decision
    // — keeps the GL clean without requiring per-line proration.
    const refNum =
      payment.stripe_payment_intent_id ?? payment.helcim_transaction_id ?? payment.id.slice(0, 21);
    lines = [
      {
        DetailType: "DescriptionOnly" as const,
        Amount: refundAmountDollars,
        Description: `Partial refund of payment ${refNum}`,
      },
    ];
  }

  // QBO RefundReceipt REQUIRES DepositToAccountRef (unlike Payment
  // where it's optional and QBO defaults to Undeposited Funds). If
  // discovery returned no candidate, fail with a clear operator-
  // facing message rather than letting QBO error with a cryptic
  // "Required param missing" — the operator needs to add a Bank or
  // Undeposited Funds account in QBO before refunds can sync.
  if (!depositAccount) {
    return {
      ok: false as const,
      error:
        "Refund needs a Deposit-To account in QBO (Bank or Undeposited Funds). " +
        "Add one in your QBO Chart of Accounts and refresh this sync.",
    };
  }

  // Refund ref-num distinguishes this from the original Payment's
  // PaymentRefNum so QBO doesn't collapse them in the audit trail. The
  // "R-" prefix is convention; truncate to QBO's 21-char limit.
  const baseRefNum =
    payment.stripe_payment_intent_id ?? payment.helcim_transaction_id ?? payment.id.slice(0, 18);
  const refundRefNum = `R-${baseRefNum}`.slice(0, 21);

  const input: QboRefundReceiptInput = {
    CustomerRef: { value: ownerMapping.qbo_id },
    TotalAmt: refundAmountDollars,
    Line: lines,
    PaymentRefNum: refundRefNum,
    CurrencyRef: { value: payment.currency as "CAD" | "USD" },
    GlobalTaxCalculation: isFullRefund ? "TaxExcluded" : "NotApplicable",
    DepositToAccountRef: depositAccount,
  };
  if (payment.processed_at) {
    input.TxnDate = payment.processed_at.slice(0, 10);
  }

  return syncOneEntity({
    admin,
    orgId,
    snoutTable: "payments",
    snoutId: paymentId,
    qboEntityType: "RefundReceipt",
    payload: input,
    create: () => createRefundReceipt(ctx, input),
    update: (current) => updateRefundReceipt(ctx, current, input),
    extractIdSyncToken: (data) => {
      const r = "RefundReceipt" in (data as Record<string, unknown>)
        ? (data as { RefundReceipt: { Id: string; SyncToken: string } }).RefundReceipt
        : (data as { Id: string; SyncToken: string });
      return { id: r.Id, syncToken: r.SyncToken };
    },
    lookupExistingByName: async () => {
      const r = await findRefundReceiptByRefNum(ctx, refundRefNum);
      if (!r.ok) return r;
      return r.data
        ? { ok: true as const, status: r.status, data: { Id: r.data.Id, SyncToken: r.data.SyncToken } }
        : { ok: true as const, status: r.status, data: null };
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureDepositAccount(admin: any, orgId: string, ctx: QboTokenContext) {
  const { data: account } = await admin
    .from("quickbooks_accounts")
    .select("default_deposit_account_id, default_deposit_account_name")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (account?.default_deposit_account_id) {
    return {
      value: account.default_deposit_account_id,
      name: account.default_deposit_account_name ?? "Deposit",
    };
  }
  const accounts = await listDepositAccounts(ctx);
  if (!accounts.ok || accounts.data.length === 0) return null;
  // Prefer Undeposited Funds (it's the QBO standard for payments
  // before they're deposited as a batch). Fall back to the first
  // active Bank account.
  const undeposited = accounts.data.find((a) => a.AccountSubType === "UndepositedFunds");
  const bank = accounts.data.find((a) => a.AccountType === "Bank");
  const pick = undeposited ?? bank ?? accounts.data[0];
  await admin
    .from("quickbooks_accounts")
    .update({
      default_deposit_account_id: pick.Id,
      default_deposit_account_name: pick.Name,
    })
    .eq("organization_id", orgId);
  return { value: pick.Id, name: pick.Name };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureIncomeAccount(admin: any, orgId: string, ctx: QboTokenContext) {
  const { data: account } = await admin
    .from("quickbooks_accounts")
    .select("default_income_account_id, default_income_account_name")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (account?.default_income_account_id) {
    return {
      value: account.default_income_account_id,
      name: account.default_income_account_name ?? "Income",
    };
  }
  const accounts = await listIncomeAccounts(ctx);
  if (!accounts.ok || accounts.data.length === 0) return null;
  const pick = accounts.data[0];
  await admin
    .from("quickbooks_accounts")
    .update({
      default_income_account_id: pick.Id,
      default_income_account_name: pick.Name,
    })
    .eq("organization_id", orgId);
  return { value: pick.Id, name: pick.Name };
}

// Identical mapping helpers to the batch sync functions. Keeping the
// payload-shape logic in the worker means the per-entity sync helpers
// in the shared lib stay generic.
function ownerToCustomerInput(owner: {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  street_address: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  notes: string | null;
}): QboCustomerInput {
  const fullName = [owner.first_name, owner.last_name].filter(Boolean).join(" ").trim();
  const displayName = fullName || owner.email || `Owner ${owner.id.slice(0, 8)}`;
  const input: QboCustomerInput = { DisplayName: displayName };
  if (owner.first_name) input.GivenName = owner.first_name;
  if (owner.last_name) input.FamilyName = owner.last_name;
  if (owner.email) input.PrimaryEmailAddr = { Address: owner.email };
  if (owner.phone) input.PrimaryPhone = { FreeFormNumber: owner.phone };
  if (owner.street_address || owner.city || owner.state_province || owner.postal_code) {
    input.BillAddr = {};
    if (owner.street_address) input.BillAddr.Line1 = owner.street_address;
    if (owner.city) input.BillAddr.City = owner.city;
    if (owner.state_province) input.BillAddr.CountrySubDivisionCode = owner.state_province;
    if (owner.postal_code) input.BillAddr.PostalCode = owner.postal_code;
  }
  if (owner.notes) input.Notes = owner.notes.slice(0, 2000);
  return input;
}

function serviceToItemInput(
  svc: { id: string; name: string; description: string | null; base_price_cents: number | null; active: boolean },
  incomeAccount: { value: string; name: string },
): QboItemInput {
  const input: QboItemInput = {
    Name: svc.name.slice(0, 100),
    Type: "Service",
    Active: svc.active,
    IncomeAccountRef: incomeAccount,
  };
  if (svc.description) input.Description = svc.description.slice(0, 4000);
  if (svc.base_price_cents !== null && svc.base_price_cents !== undefined) {
    input.UnitPrice = Number((svc.base_price_cents / 100).toFixed(2));
  }
  return input;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
