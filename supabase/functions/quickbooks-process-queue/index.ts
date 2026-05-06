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
  createItem,
  getTokenContext,
  listIncomeAccounts,
  syncOneEntity,
  updateCustomer,
  updateItem,
  type QboCustomerInput,
  type QboItemInput,
  type QboTokenContext,
} from "../_shared/quickbooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
  // token against the env var rather than verifying any user JWT.
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token !== SUPABASE_SERVICE_ROLE_KEY) {
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
  });
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
