// Pushes Snout services to QuickBooks Online as Item entities
// (Type: Service). Mirrors the customer sync's idempotency model.
//
// Income account selection: every QBO item create must reference an
// existing income account on the operator's books. We auto-pick the
// first active Income-type account on the first item sync and stash
// it on quickbooks_accounts.default_income_account_id so subsequent
// syncs reuse the same account without re-querying. Operators can
// later change this from a settings UI; today, the choice is
// auto-discovered and survives reconnects through the same column.
//
// Products: Snout does not have a separate products table today; this
// function only syncs services. When a products surface lands, this
// function gains a second pass that reads from products and creates
// Type='NonInventory' items.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";
import {
  createItem,
  getTokenContext,
  listIncomeAccounts,
  payloadHash,
  updateItem,
  type QboItemInput,
  type QboTokenContext,
} from "../_shared/quickbooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTUIT_CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID");
const INTUIT_CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET");

const BATCH_LIMIT = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!INTUIT_CLIENT_ID || !INTUIT_CLIENT_SECRET) {
      return json({ error: "QuickBooks integration is not configured" }, 503);
    }
    const ctx = await requireOrgAdmin(req);
    if (!ctx) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const tokens = await getTokenContext({
      admin,
      orgId: ctx.orgId,
      clientId: INTUIT_CLIENT_ID,
      clientSecret: INTUIT_CLIENT_SECRET,
    });
    if (!tokens) {
      return json({ error: "QuickBooks is not connected for this organization" }, 400);
    }

    // Resolve the IncomeAccountRef. Reuse the persisted choice if
    // present; otherwise query QBO for the first active Income account
    // and persist it for next time.
    const incomeAccount = await ensureIncomeAccount(admin, ctx.orgId, tokens);
    if (!incomeAccount) {
      return json(
        {
          error:
            "No active Income account in QuickBooks. Create or activate an Income account in QBO and try again.",
        },
        400,
      );
    }

    const { data: services, error: servicesErr } = await admin
      .from("services")
      .select("id, name, description, base_price_cents, active")
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (servicesErr) {
      console.error("services query failed:", servicesErr);
      return json({ error: "Could not load services", details: servicesErr.message }, 500);
    }

    const serviceIds = (services ?? []).map((s) => s.id);
    const { data: mappings } = await admin
      .from("quickbooks_entity_mappings")
      .select("id, snout_id, qbo_id, sync_token, payload_hash, sync_state")
      .eq("organization_id", ctx.orgId)
      .eq("snout_table", "services")
      .in("snout_id", serviceIds.length > 0 ? serviceIds : ["00000000-0000-0000-0000-000000000000"])
      .is("deleted_at", null);
    const mappingByService = new Map<string, any>();
    for (const m of mappings ?? []) mappingByService.set(m.snout_id, m);

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    const failures: Array<{ snout_id: string; reason: string }> = [];

    for (const svc of services ?? []) {
      const input = serviceToItemInput(svc, incomeAccount);
      const hash = await payloadHash(input);
      const existing = mappingByService.get(svc.id);

      try {
        if (!existing) {
          const result = await createItem(tokens, input);
          if (!result.ok) {
            failed += 1;
            failures.push({ snout_id: svc.id, reason: result.error });
            await admin.from("quickbooks_entity_mappings").insert({
              organization_id: ctx.orgId,
              snout_table: "services",
              snout_id: svc.id,
              qbo_entity_type: "Item",
              qbo_id: "",
              payload_hash: hash,
              sync_state: "failed",
              last_error: result.error,
            });
            continue;
          }
          await admin.from("quickbooks_entity_mappings").insert({
            organization_id: ctx.orgId,
            snout_table: "services",
            snout_id: svc.id,
            qbo_entity_type: "Item",
            qbo_id: result.data.Item.Id,
            sync_token: result.data.Item.SyncToken,
            payload_hash: hash,
            sync_state: "synced",
            last_synced_at: new Date().toISOString(),
          });
          created += 1;
        } else if (existing.sync_state === "synced" && existing.payload_hash === hash) {
          unchanged += 1;
        } else if (existing.qbo_id && existing.sync_token) {
          const result = await updateItem(
            tokens,
            { Id: existing.qbo_id, SyncToken: existing.sync_token },
            input,
          );
          if (!result.ok) {
            failed += 1;
            failures.push({ snout_id: svc.id, reason: result.error });
            await admin
              .from("quickbooks_entity_mappings")
              .update({ sync_state: "failed", last_error: result.error })
              .eq("id", existing.id);
            continue;
          }
          await admin
            .from("quickbooks_entity_mappings")
            .update({
              sync_token: result.data.Item.SyncToken,
              payload_hash: hash,
              sync_state: "synced",
              last_error: null,
              last_synced_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          updated += 1;
        } else {
          // Mapping exists but is incomplete (previous failure); retry create.
          const result = await createItem(tokens, input);
          if (!result.ok) {
            failed += 1;
            failures.push({ snout_id: svc.id, reason: result.error });
            await admin
              .from("quickbooks_entity_mappings")
              .update({ sync_state: "failed", last_error: result.error, payload_hash: hash })
              .eq("id", existing.id);
            continue;
          }
          await admin
            .from("quickbooks_entity_mappings")
            .update({
              qbo_id: result.data.Item.Id,
              sync_token: result.data.Item.SyncToken,
              payload_hash: hash,
              sync_state: "synced",
              last_error: null,
              last_synced_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          created += 1;
        }
      } catch (e) {
        failed += 1;
        failures.push({ snout_id: svc.id, reason: (e as Error).message });
      }
    }

    return json({
      ok: true,
      processed: services?.length ?? 0,
      created,
      updated,
      unchanged,
      failed,
      failures: failures.slice(0, 20),
      batch_limit: BATCH_LIMIT,
      income_account: { id: incomeAccount.value, name: incomeAccount.name },
    });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`quickbooks-sync-items error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

// Resolve the income account ref to use for item creates. Cached on
// quickbooks_accounts.default_income_account_id so we hit Intuit's
// account list at most once per connection.
async function ensureIncomeAccount(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  tokens: QboTokenContext,
): Promise<{ value: string; name: string } | null> {
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

  const accounts = await listIncomeAccounts(tokens);
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

function serviceToItemInput(
  svc: {
    id: string;
    name: string;
    description: string | null;
    base_price_cents: number | null;
    active: boolean;
  },
  incomeAccount: { value: string; name: string },
): QboItemInput {
  // QBO requires Item names to be unique within the company (and 100
  // chars or less). We rely on Snout-side service names being unique
  // enough; conflicts will surface as failed syncs in the response.
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
