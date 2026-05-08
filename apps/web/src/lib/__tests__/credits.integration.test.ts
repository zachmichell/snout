import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from "vitest";
import { createTestClient } from "@/test/supabase-test-client";

// Integration tests for the credit ledger SQL functions.
//
// Fixture model: a temporary organization is created in beforeAll and
// deleted in afterAll. Each test creates a disposable owner inside that
// org; the FK ON DELETE CASCADE on credit_ledger.owner_id sweeps the
// ledger rows when the owner is deleted. The whole fixture vanishes
// when the org row is deleted in afterAll.
//
// Required env: SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY.
// For non-local URLs, also SUPABASE_TEST_ALLOW_NONLOCAL=1.

const sb = createTestClient();
const FIXTURE_TAG = "integration-test-fixture";

let ORG_ID: string;

async function createTestOwner(): Promise<string> {
  const { data, error } = await sb
    .from("owners")
    .insert({
      organization_id: ORG_ID,
      first_name: "INTTEST",
      last_name: `Owner_${Math.random().toString(36).slice(2, 8)}`,
      external_source: FIXTURE_TAG,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id;
}

async function deleteTestOwner(ownerId: string) {
  await sb.from("owners").delete().eq("id", ownerId);
}

async function insertLedger(row: {
  ownerId: string;
  kind:
    | "opening_balance"
    | "purchase"
    | "consumption"
    | "refund"
    | "expiration"
    | "manual_adjustment";
  full?: number;
  half?: number;
  nights?: number;
  expiresAt?: string | null;
  sourcePurchaseId?: string | null;
  note?: string | null;
}) {
  const { data, error } = await sb
    .from("credit_ledger")
    .insert({
      organization_id: ORG_ID,
      owner_id: row.ownerId,
      kind: row.kind,
      delta_full: row.full ?? 0,
      delta_half: row.half ?? 0,
      delta_nights: row.nights ?? 0,
      expires_at: row.expiresAt ?? null,
      source_purchase_id: row.sourcePurchaseId ?? null,
      note: row.note ?? null,
      actor_kind: "system",
      actor_label: "Test",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function getCache(ownerId: string) {
  const { data, error } = await sb
    .from("owners")
    .select("daycare_full_day_credits, daycare_half_day_credits, boarding_night_credits")
    .eq("id", ownerId)
    .single();
  if (error) throw error;
  return {
    full: data!.daycare_full_day_credits ?? 0,
    half: data!.daycare_half_day_credits ?? 0,
    nights: data!.boarding_night_credits ?? 0,
  };
}

async function getLedger(ownerId: string) {
  const { data, error } = await sb
    .from("credit_ledger")
    .select("kind, delta_full, delta_half, delta_nights, source_purchase_id, expires_at, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

beforeAll(async () => {
  // Create the temporary fixture org. A unique name and slug avoid
  // collisions with parallel runs and survive a crashed prior run.
  const tag = `__test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await sb
    .from("organizations")
    .insert({
      name: tag,
      slug: tag,
      country: "CA",
      currency: "CAD",
    })
    .select("id")
    .single();
  if (error) throw error;
  ORG_ID = data!.id;
});

afterAll(async () => {
  // Deleting the org cascades to owners and ledger rows.
  if (ORG_ID) await sb.from("organizations").delete().eq("id", ORG_ID);
});

describe("consume_credits", () => {
  let ownerId: string;
  beforeEach(async () => {
    ownerId = await createTestOwner();
  });
  afterEach(async () => {
    await deleteTestOwner(ownerId);
  });

  it("sufficient single purchase deducts and writes one consumption row", async () => {
    await insertLedger({ ownerId, kind: "purchase", full: 5 });

    const { data, error } = await sb.rpc("consume_credits", {
      p_owner_id: ownerId,
      p_reservation_id: crypto.randomUUID(),
      p_need_full: 2,
      p_need_half: 0,
      p_need_nights: 0,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ used: true, full: 2 });

    const cache = await getCache(ownerId);
    expect(cache.full).toBe(3);

    const rows = await getLedger(ownerId);
    expect(rows).toHaveLength(2);
    const consumption = rows.find((r) => r.kind === "consumption")!;
    expect(consumption.delta_full).toBe(-2);
    expect(consumption.source_purchase_id).not.toBeNull();
  });

  it("FIFO across two purchases: oldest first, spillover to next", async () => {
    const oldId = await insertLedger({ ownerId, kind: "purchase", full: 2 });
    // 50ms gap to guarantee a later created_at on the second purchase
    await new Promise((r) => setTimeout(r, 50));
    const newId = await insertLedger({ ownerId, kind: "purchase", full: 5 });

    const { error } = await sb.rpc("consume_credits", {
      p_owner_id: ownerId,
      p_reservation_id: crypto.randomUUID(),
      p_need_full: 4,
      p_need_half: 0,
      p_need_nights: 0,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    expect(error).toBeNull();

    const consumptions = (await getLedger(ownerId)).filter((r) => r.kind === "consumption");
    expect(consumptions).toHaveLength(2);
    // Oldest purchase fully drained first (-2), then -2 from the newer one
    const fromOld = consumptions.find((c) => c.source_purchase_id === oldId);
    const fromNew = consumptions.find((c) => c.source_purchase_id === newId);
    expect(fromOld?.delta_full).toBe(-2);
    expect(fromNew?.delta_full).toBe(-2);

    const cache = await getCache(ownerId);
    expect(cache.full).toBe(3);
  });

  it("insufficient rolls back: no consumption rows written, cache unchanged", async () => {
    await insertLedger({ ownerId, kind: "purchase", full: 2 });

    const { error } = await sb.rpc("consume_credits", {
      p_owner_id: ownerId,
      p_reservation_id: crypto.randomUUID(),
      p_need_full: 5,
      p_need_half: 0,
      p_need_nights: 0,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/Insufficient/);

    const rows = await getLedger(ownerId);
    expect(rows.filter((r) => r.kind === "consumption")).toHaveLength(0);

    const cache = await getCache(ownerId);
    expect(cache.full).toBe(2);
  });

  it("skips expired purchase even with nominal balance", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await insertLedger({
      ownerId,
      kind: "purchase",
      full: 5,
      expiresAt: yesterday,
    });

    const { error } = await sb.rpc("consume_credits", {
      p_owner_id: ownerId,
      p_reservation_id: crypto.randomUUID(),
      p_need_full: 1,
      p_need_half: 0,
      p_need_nights: 0,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/Insufficient/);
  });

  it("two concurrent calls cannot both spend the last credit", async () => {
    await insertLedger({ ownerId, kind: "purchase", full: 1 });

    const args = {
      p_owner_id: ownerId,
      p_need_full: 1,
      p_need_half: 0,
      p_need_nights: 0,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    };

    const [a, b] = await Promise.allSettled([
      sb.rpc("consume_credits", { ...args, p_reservation_id: crypto.randomUUID() }),
      sb.rpc("consume_credits", { ...args, p_reservation_id: crypto.randomUUID() }),
    ]);

    const successes = [a, b].filter(
      (r) => r.status === "fulfilled" && !r.value.error,
    ) as PromiseFulfilledResult<{ data: unknown; error: null }>[];
    const failures = [a, b].filter(
      (r) => r.status === "fulfilled" && r.value.error,
    ) as PromiseFulfilledResult<{ data: unknown; error: { message: string } }>[];

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].value.error.message).toMatch(/Insufficient/);

    const cache = await getCache(ownerId);
    expect(cache.full).toBe(0);
  });

  it("refund row re-credits the active balance", async () => {
    const purchaseId = await insertLedger({ ownerId, kind: "purchase", full: 5 });

    await sb.rpc("consume_credits", {
      p_owner_id: ownerId,
      p_reservation_id: crypto.randomUUID(),
      p_need_full: 3,
      p_need_half: 0,
      p_need_nights: 0,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    expect((await getCache(ownerId)).full).toBe(2);

    // Refund: reservation cancelled, refund 1 full to the original purchase
    await insertLedger({
      ownerId,
      kind: "refund",
      full: 1,
      sourcePurchaseId: purchaseId,
      note: "Reservation cancelled",
    });

    expect((await getCache(ownerId)).full).toBe(3);
  });
});

describe("expire_credits", () => {
  let ownerId: string;
  beforeEach(async () => {
    ownerId = await createTestOwner();
  });
  afterEach(async () => {
    await deleteTestOwner(ownerId);
  });

  it("writes an expiration row for unused remainder of expired purchase", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const purchaseId = await insertLedger({
      ownerId,
      kind: "purchase",
      full: 10,
      expiresAt: yesterday,
    });
    // Two consumption rows totaling 4 full
    await insertLedger({
      ownerId,
      kind: "consumption",
      full: -3,
      sourcePurchaseId: purchaseId,
    });
    await insertLedger({
      ownerId,
      kind: "consumption",
      full: -1,
      sourcePurchaseId: purchaseId,
    });

    const { data, error } = await sb.rpc("expire_credits", { p_organization_id: ORG_ID });
    expect(error).toBeNull();
    expect((data as { expired_count: number }).expired_count).toBeGreaterThanOrEqual(1);

    const expirationRows = (await getLedger(ownerId)).filter((r) => r.kind === "expiration");
    expect(expirationRows).toHaveLength(1);
    expect(expirationRows[0].delta_full).toBe(-6); // 10 minus 4 consumed
    expect(expirationRows[0].source_purchase_id).toBe(purchaseId);
  });

  it("is idempotent: a second call writes no additional rows", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await insertLedger({
      ownerId,
      kind: "purchase",
      full: 4,
      expiresAt: yesterday,
    });

    await sb.rpc("expire_credits", { p_organization_id: ORG_ID });
    const rowsAfterFirst = (await getLedger(ownerId)).filter((r) => r.kind === "expiration");
    expect(rowsAfterFirst).toHaveLength(1);

    await sb.rpc("expire_credits", { p_organization_id: ORG_ID });
    const rowsAfterSecond = (await getLedger(ownerId)).filter((r) => r.kind === "expiration");
    expect(rowsAfterSecond).toHaveLength(1);
  });

  it("writes nothing when the purchase was fully consumed before expiry", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const purchaseId = await insertLedger({
      ownerId,
      kind: "purchase",
      full: 2,
      expiresAt: yesterday,
    });
    await insertLedger({
      ownerId,
      kind: "consumption",
      full: -2,
      sourcePurchaseId: purchaseId,
    });

    await sb.rpc("expire_credits", { p_organization_id: ORG_ID });
    const expirations = (await getLedger(ownerId)).filter((r) => r.kind === "expiration");
    expect(expirations).toHaveLength(0);
  });
});

describe("transfer_credits", () => {
  let fromOwnerId: string;
  let toOwnerId: string;
  beforeEach(async () => {
    fromOwnerId = await createTestOwner();
    toOwnerId = await createTestOwner();
  });
  afterEach(async () => {
    await deleteTestOwner(fromOwnerId);
    await deleteTestOwner(toOwnerId);
  });

  it("preserves the org-wide total: 5 full from A to B yields A=0,B=5 with both legs as manual_adjustment", async () => {
    await insertLedger({ ownerId: fromOwnerId, kind: "purchase", full: 5 });
    expect((await getCache(fromOwnerId)).full).toBe(5);
    expect((await getCache(toOwnerId)).full).toBe(0);

    const { data, error } = await sb.rpc("transfer_credits", {
      p_from_owner_id: fromOwnerId,
      p_to_owner_id: toOwnerId,
      p_full: 5,
      p_half: 0,
      p_nights: 0,
      p_note: "moved households",
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, full: 5 });
    const transferId = (data as { transfer_id: string }).transfer_id;
    expect(transferId).toBeTruthy();

    expect((await getCache(fromOwnerId)).full).toBe(0);
    expect((await getCache(toOwnerId)).full).toBe(5);

    // Both legs are manual_adjustment rows tagged with the same transfer id.
    const fromRows = (await getLedger(fromOwnerId)).filter(
      (r) => r.kind === "manual_adjustment",
    );
    const toRows = (await getLedger(toOwnerId)).filter(
      (r) => r.kind === "manual_adjustment",
    );
    expect(fromRows).toHaveLength(1);
    expect(toRows).toHaveLength(1);
    expect(fromRows[0].delta_full).toBe(-5);
    expect(toRows[0].delta_full).toBe(5);
  });

  it("rejects when source has insufficient credits — neither leg lands", async () => {
    await insertLedger({ ownerId: fromOwnerId, kind: "purchase", full: 2 });

    const { error } = await sb.rpc("transfer_credits", {
      p_from_owner_id: fromOwnerId,
      p_to_owner_id: toOwnerId,
      p_full: 5,
      p_half: 0,
      p_nights: 0,
      p_note: null,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/[Ii]nsufficient/);

    // Both owners untouched.
    expect((await getCache(fromOwnerId)).full).toBe(2);
    expect((await getCache(toOwnerId)).full).toBe(0);
    expect(
      (await getLedger(fromOwnerId)).filter((r) => r.kind === "manual_adjustment"),
    ).toHaveLength(0);
    expect(
      (await getLedger(toOwnerId)).filter((r) => r.kind === "manual_adjustment"),
    ).toHaveLength(0);
  });

  it("rejects same-owner self-transfer", async () => {
    await insertLedger({ ownerId: fromOwnerId, kind: "purchase", full: 5 });
    const { error } = await sb.rpc("transfer_credits", {
      p_from_owner_id: fromOwnerId,
      p_to_owner_id: fromOwnerId,
      p_full: 1,
      p_half: 0,
      p_nights: 0,
      p_note: null,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/owners must differ|differ/);
  });

  it("rejects zero-count transfer", async () => {
    const { error } = await sb.rpc("transfer_credits", {
      p_from_owner_id: fromOwnerId,
      p_to_owner_id: toOwnerId,
      p_full: 0,
      p_half: 0,
      p_nights: 0,
      p_note: null,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/at least one credit/);
  });

  it("transfers a mix of types in one call: full + nights together", async () => {
    await insertLedger({ ownerId: fromOwnerId, kind: "purchase", full: 3 });
    await insertLedger({ ownerId: fromOwnerId, kind: "purchase", nights: 2 });

    const { error } = await sb.rpc("transfer_credits", {
      p_from_owner_id: fromOwnerId,
      p_to_owner_id: toOwnerId,
      p_full: 2,
      p_half: 0,
      p_nights: 1,
      p_note: null,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    expect(error).toBeNull();

    const from = await getCache(fromOwnerId);
    const to = await getCache(toOwnerId);
    expect(from.full).toBe(1);
    expect(from.nights).toBe(1);
    expect(to.full).toBe(2);
    expect(to.nights).toBe(1);
    // Total preserved across the org
    expect(from.full + to.full).toBe(3);
    expect(from.nights + to.nights).toBe(2);
  });
});

describe("full-reservation refund", () => {
  let ownerId: string;
  beforeEach(async () => {
    ownerId = await createTestOwner();
  });
  afterEach(async () => {
    await deleteTestOwner(ownerId);
  });

  it("refunds the entire consumption of a cancelled reservation back to the original purchase", async () => {
    // Operator buys a 10-pack, two reservations consume from it,
    // then one of those reservations is cancelled and we want the
    // full consumption of THAT reservation to refund.
    const purchaseId = await insertLedger({
      ownerId,
      kind: "purchase",
      full: 10,
    });

    const reservationA = crypto.randomUUID();
    const reservationB = crypto.randomUUID();

    await sb.rpc("consume_credits", {
      p_owner_id: ownerId,
      p_reservation_id: reservationA,
      p_need_full: 3,
      p_need_half: 0,
      p_need_nights: 0,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    await sb.rpc("consume_credits", {
      p_owner_id: ownerId,
      p_reservation_id: reservationB,
      p_need_full: 2,
      p_need_half: 0,
      p_need_nights: 0,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    expect((await getCache(ownerId)).full).toBe(5);

    // Reservation A is cancelled and we refund its three credits.
    await insertLedger({
      ownerId,
      kind: "refund",
      full: 3,
      sourcePurchaseId: purchaseId,
      note: `Reservation ${reservationA} cancelled`,
    });

    expect((await getCache(ownerId)).full).toBe(8);

    // The refund is anchored to the original purchase so the audit trail
    // can match cancellation to its source.
    const refunds = (await getLedger(ownerId)).filter((r) => r.kind === "refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0].source_purchase_id).toBe(purchaseId);
    expect(refunds[0].delta_full).toBe(3);
  });
});

describe("apply_credit_adjustment", () => {
  let ownerId: string;
  beforeEach(async () => {
    ownerId = await createTestOwner();
  });
  afterEach(async () => {
    await deleteTestOwner(ownerId);
  });

  it("positive adjustment writes a single manual_adjustment row", async () => {
    await sb.rpc("apply_credit_adjustment", {
      p_owner_id: ownerId,
      p_delta_full: 5,
      p_delta_half: 0,
      p_delta_nights: 2,
      p_note: "Comp",
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });

    const rows = (await getLedger(ownerId)).filter((r) => r.kind === "manual_adjustment");
    expect(rows).toHaveLength(1);
    expect(rows[0].delta_full).toBe(5);
    expect(rows[0].delta_nights).toBe(2);
    expect(rows[0].source_purchase_id).toBeNull();

    const cache = await getCache(ownerId);
    expect(cache.full).toBe(5);
    expect(cache.nights).toBe(2);
  });

  it("negative adjustment FIFO walks active purchases", async () => {
    const oldId = await insertLedger({ ownerId, kind: "purchase", full: 3 });
    await new Promise((r) => setTimeout(r, 50));
    const newId = await insertLedger({ ownerId, kind: "purchase", full: 4 });

    await sb.rpc("apply_credit_adjustment", {
      p_owner_id: ownerId,
      p_delta_full: -5,
      p_delta_half: 0,
      p_delta_nights: 0,
      p_note: "Correction",
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });

    const adjustments = (await getLedger(ownerId)).filter((r) => r.kind === "manual_adjustment");
    expect(adjustments).toHaveLength(2);
    const fromOld = adjustments.find((a) => a.source_purchase_id === oldId);
    const fromNew = adjustments.find((a) => a.source_purchase_id === newId);
    expect(fromOld?.delta_full).toBe(-3);
    expect(fromNew?.delta_full).toBe(-2);

    const cache = await getCache(ownerId);
    expect(cache.full).toBe(2);
  });

  it("rejects a negative adjustment that would put balance below zero", async () => {
    await insertLedger({ ownerId, kind: "purchase", full: 1 });

    const { error } = await sb.rpc("apply_credit_adjustment", {
      p_owner_id: ownerId,
      p_delta_full: -5,
      p_delta_half: 0,
      p_delta_nights: 0,
      p_note: null,
      p_actor_kind: "staff",
      p_actor_label: "Test",
      p_staff_code_id: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/balance below zero|Insufficient/);

    const cache = await getCache(ownerId);
    expect(cache.full).toBe(1);
  });
});
