// Pushes Snout owners to QuickBooks Online as Customer entities.
//
// Idempotency model: every owner has at most one live row in
// quickbooks_entity_mappings. On each invocation we:
//   1. Pull all owners for the org with deleted_at IS NULL.
//   2. Join against existing mappings to know which are new (no
//      mapping yet), updatable (mapping exists, hash changed), or
//      already-synced (mapping exists, hash unchanged).
//   3. For new entities: POST create, store mapping with QBO Id +
//      SyncToken + payload_hash + sync_state='synced'.
//   4. For updatable entities: POST sparse update including the
//      stored SyncToken, refresh the mapping with the new SyncToken
//      and payload_hash.
//   5. Already-synced entities are skipped.
//
// Concurrency: the sync function is single-threaded per invocation.
// Multiple concurrent invocations against the same org would issue
// duplicate creates; the unique index on
// (organization_id, snout_table, snout_id) catches the duplicate at
// insert-mapping time and we report that as a conflict. The settings
// UI prevents kicking off two syncs at once for the same org.
//
// Batch limit: 100 owners per invocation. Operators with more should
// re-run the sync; pagination via cursor lands in a follow-up if it
// turns out to matter for any real customer.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireOrgAdmin } from "../_shared/auth.ts";
import {
  createCustomer,
  getTokenContext,
  payloadHash,
  updateCustomer,
  type QboCustomerInput,
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

    // Pull owners for this org. Limit + simple ordering keeps the
    // batch deterministic across re-runs.
    const { data: owners, error: ownersErr } = await admin
      .from("owners")
      .select(
        "id, first_name, last_name, email, phone, street_address, city, state_province, postal_code, notes",
      )
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (ownersErr) {
      console.error("owners query failed:", ownersErr);
      return json({ error: "Could not load owners", details: ownersErr.message }, 500);
    }

    // Existing mappings keyed by snout_id for fast lookup.
    const ownerIds = (owners ?? []).map((o) => o.id);
    const { data: mappings } = await admin
      .from("quickbooks_entity_mappings")
      .select("id, snout_id, qbo_id, sync_token, payload_hash, sync_state")
      .eq("organization_id", ctx.orgId)
      .eq("snout_table", "owners")
      .in("snout_id", ownerIds.length > 0 ? ownerIds : ["00000000-0000-0000-0000-000000000000"])
      .is("deleted_at", null);
    const mappingByOwner = new Map<string, any>();
    for (const m of mappings ?? []) mappingByOwner.set(m.snout_id, m);

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    const failures: Array<{ snout_id: string; reason: string }> = [];

    for (const owner of owners ?? []) {
      const input = ownerToCustomerInput(owner);
      const hash = await payloadHash(input);
      const existing = mappingByOwner.get(owner.id);

      try {
        if (!existing) {
          // Create path.
          const result = await createCustomer(tokens, input);
          if (!result.ok) {
            failed += 1;
            failures.push({ snout_id: owner.id, reason: result.error });
            await upsertMapping(admin, ctx.orgId, owner.id, {
              qbo_id: "",
              sync_token: null,
              payload_hash: hash,
              sync_state: "failed",
              last_error: result.error,
              skipQboIdConflict: true,
            });
            continue;
          }
          await upsertMapping(admin, ctx.orgId, owner.id, {
            qbo_id: result.data.Customer.Id,
            sync_token: result.data.Customer.SyncToken,
            payload_hash: hash,
            sync_state: "synced",
            last_error: null,
          });
          created += 1;
        } else if (existing.sync_state === "synced" && existing.payload_hash === hash) {
          unchanged += 1;
        } else if (existing.qbo_id && existing.sync_token) {
          // Update path.
          const result = await updateCustomer(
            tokens,
            { Id: existing.qbo_id, SyncToken: existing.sync_token },
            input,
          );
          if (!result.ok) {
            failed += 1;
            failures.push({ snout_id: owner.id, reason: result.error });
            await admin
              .from("quickbooks_entity_mappings")
              .update({ sync_state: "failed", last_error: result.error })
              .eq("id", existing.id);
            continue;
          }
          await admin
            .from("quickbooks_entity_mappings")
            .update({
              sync_token: result.data.Customer.SyncToken,
              payload_hash: hash,
              sync_state: "synced",
              last_error: null,
              last_synced_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          updated += 1;
        } else {
          // Mapping exists but is incomplete (previous failure with no
          // qbo_id stamped). Re-attempt as a create.
          const result = await createCustomer(tokens, input);
          if (!result.ok) {
            failed += 1;
            failures.push({ snout_id: owner.id, reason: result.error });
            await admin
              .from("quickbooks_entity_mappings")
              .update({ sync_state: "failed", last_error: result.error, payload_hash: hash })
              .eq("id", existing.id);
            continue;
          }
          await admin
            .from("quickbooks_entity_mappings")
            .update({
              qbo_id: result.data.Customer.Id,
              sync_token: result.data.Customer.SyncToken,
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
        failures.push({ snout_id: owner.id, reason: (e as Error).message });
      }
    }

    return json({
      ok: true,
      processed: owners?.length ?? 0,
      created,
      updated,
      unchanged,
      failed,
      failures: failures.slice(0, 20),
      batch_limit: BATCH_LIMIT,
    });
  } catch (err) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`quickbooks-sync-customers error [${errorId}]:`, err);
    return json({ error: "Internal error", error_id: errorId }, 500);
  }
});

// Map a Snout owner row to a QBO Customer create payload. DisplayName
// is required and unique within the QBO company; we use "First Last"
// and fall back to email when names are missing.
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
  if (owner.notes) input.Notes = owner.notes.slice(0, 2000); // QBO Notes is limited
  return input;
}

async function upsertMapping(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  snoutId: string,
  args: {
    qbo_id: string;
    sync_token: string | null;
    payload_hash: string;
    sync_state: "pending" | "synced" | "failed" | "orphaned";
    last_error: string | null;
    skipQboIdConflict?: boolean;
  },
) {
  // Plain INSERT. The caller has already established there is no live
  // mapping for this snout_id; existing-mapping paths use UPDATE
  // directly against the row id rather than going through this helper.
  // The partial unique index on (org, snout_table, snout_id) WHERE
  // deleted_at IS NULL guards against accidental duplicates from
  // concurrent invocations and surfaces them as 23505 in the logs.
  const payload: Record<string, unknown> = {
    organization_id: orgId,
    snout_table: "owners",
    snout_id: snoutId,
    qbo_entity_type: "Customer",
    qbo_id: args.qbo_id,
    sync_token: args.sync_token,
    payload_hash: args.payload_hash,
    sync_state: args.sync_state,
    last_error: args.last_error,
    last_synced_at: args.sync_state === "synced" ? new Date().toISOString() : null,
  };
  const { error } = await admin.from("quickbooks_entity_mappings").insert(payload);
  if (error) {
    console.error("mapping insert failed:", error);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
