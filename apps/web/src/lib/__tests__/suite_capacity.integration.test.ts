import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { createTestClient } from "@/test/supabase-test-client";

// Integration tests for the suite-oversell prevention trigger.
//
// Fixture model: a temporary organization, a location, two suites (one with
// capacity 1, one with capacity 2), an owner, and a boarding service. The
// trigger logic on the reservations table is exercised by inserting and
// updating reservations against those suites. The fixture is torn down in
// afterAll by deleting the organization (cascades through everything).

const sb = createTestClient();

let ORG_ID: string;
let LOC_ID: string;
let SVC_ID: string;
let OWNER_ID: string;
let SUITE_CAP1: string;
let SUITE_CAP2: string;

const tag = `__test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function insertReservation(opts: {
  suiteId: string;
  startAt: string;
  endAt: string;
  status?: "requested" | "confirmed" | "checked_in" | "cancelled";
}) {
  return sb
    .from("reservations")
    .insert({
      organization_id: ORG_ID,
      location_id: LOC_ID,
      service_id: SVC_ID,
      primary_owner_id: OWNER_ID,
      suite_id: opts.suiteId,
      status: opts.status ?? "confirmed",
      source: "staff_created",
      start_at: opts.startAt,
      end_at: opts.endAt,
      requested_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
}

beforeAll(async () => {
  const { data: org, error: orgErr } = await sb
    .from("organizations")
    .insert({ name: tag, slug: tag, country: "CA", currency: "CAD" })
    .select("id")
    .single();
  if (orgErr) throw orgErr;
  ORG_ID = org!.id;

  const { data: loc, error: locErr } = await sb
    .from("locations")
    .insert({ organization_id: ORG_ID, name: "Test location" })
    .select("id")
    .single();
  if (locErr) throw locErr;
  LOC_ID = loc!.id;

  const { data: svc, error: svcErr } = await sb
    .from("services")
    .insert({
      organization_id: ORG_ID,
      location_id: LOC_ID,
      module: "boarding",
      name: "Test boarding",
      duration_type: "overnight",
      base_price_cents: 5000,
      active: true,
    })
    .select("id")
    .single();
  if (svcErr) throw svcErr;
  SVC_ID = svc!.id;

  const { data: cap1, error: cap1Err } = await sb
    .from("suites")
    .insert({
      organization_id: ORG_ID,
      location_id: LOC_ID,
      name: "Cap1",
      type: "standard",
      capacity: 1,
      daily_rate_cents: 5000,
      status: "active",
    })
    .select("id")
    .single();
  if (cap1Err) throw cap1Err;
  SUITE_CAP1 = cap1!.id;

  const { data: cap2, error: cap2Err } = await sb
    .from("suites")
    .insert({
      organization_id: ORG_ID,
      location_id: LOC_ID,
      name: "Cap2",
      type: "standard",
      capacity: 2,
      daily_rate_cents: 5000,
      status: "active",
    })
    .select("id")
    .single();
  if (cap2Err) throw cap2Err;
  SUITE_CAP2 = cap2!.id;

  const { data: owner, error: ownerErr } = await sb
    .from("owners")
    .insert({
      organization_id: ORG_ID,
      first_name: "Suite",
      last_name: "Tester",
      external_source: "integration-test-fixture",
    })
    .select("id")
    .single();
  if (ownerErr) throw ownerErr;
  OWNER_ID = owner!.id;
});

afterAll(async () => {
  if (ORG_ID) await sb.from("organizations").delete().eq("id", ORG_ID);
});

beforeEach(async () => {
  await sb.from("reservations").delete().eq("organization_id", ORG_ID);
});

describe("suite capacity (capacity = 1)", () => {
  const start = "2027-01-10T22:00:00Z";
  const end = "2027-01-12T16:00:00Z";

  it("allows the first reservation", async () => {
    const { data, error } = await insertReservation({
      suiteId: SUITE_CAP1,
      startAt: start,
      endAt: end,
    });
    expect(error).toBeNull();
    expect(data?.id).toBeDefined();
  });

  it("rejects a second reservation overlapping the first", async () => {
    await insertReservation({ suiteId: SUITE_CAP1, startAt: start, endAt: end });
    const { error } = await insertReservation({
      suiteId: SUITE_CAP1,
      startAt: "2027-01-11T08:00:00Z", // inside the first window
      endAt: "2027-01-13T16:00:00Z",
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/at capacity|full for the requested|exclusion constraint/i);
  });

  it("allows back-to-back reservations (half-open: end equals start)", async () => {
    await insertReservation({ suiteId: SUITE_CAP1, startAt: start, endAt: end });
    const { error } = await insertReservation({
      suiteId: SUITE_CAP1,
      startAt: end, // exactly when the previous ends
      endAt: "2027-01-14T16:00:00Z",
    });
    expect(error).toBeNull();
  });

  it("does not count a cancelled reservation as occupying", async () => {
    await insertReservation({
      suiteId: SUITE_CAP1,
      startAt: start,
      endAt: end,
      status: "cancelled",
    });
    const { error } = await insertReservation({
      suiteId: SUITE_CAP1,
      startAt: "2027-01-11T08:00:00Z",
      endAt: "2027-01-13T16:00:00Z",
    });
    expect(error).toBeNull();
  });

  it("rejects an update that moves an existing reservation onto a full suite", async () => {
    // Two suites of capacity 1; reservation A on Cap1, reservation B on Cap2.
    // Try to move B onto Cap1 while A is there.
    await insertReservation({ suiteId: SUITE_CAP1, startAt: start, endAt: end });
    const { data: b } = await insertReservation({
      suiteId: SUITE_CAP2,
      startAt: start,
      endAt: end,
    });
    const { error } = await sb
      .from("reservations")
      .update({ suite_id: SUITE_CAP1 })
      .eq("id", b!.id);
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/at capacity|full for the requested|exclusion constraint/i);
  });

  it("rejects an update that extends a reservation into a conflict", async () => {
    // A occupies Jan 10-12 on Cap1. B is on Cap1 from Jan 14-16 (no overlap).
    // Try to move B's start_at earlier into A's window.
    await insertReservation({ suiteId: SUITE_CAP1, startAt: start, endAt: end });
    const { data: b } = await insertReservation({
      suiteId: SUITE_CAP1,
      startAt: "2027-01-14T22:00:00Z",
      endAt: "2027-01-16T16:00:00Z",
    });
    const { error } = await sb
      .from("reservations")
      .update({ start_at: "2027-01-11T22:00:00Z" })
      .eq("id", b!.id);
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/at capacity|full for the requested|exclusion constraint/i);
  });
});

describe("suite capacity (capacity = 2)", () => {
  const start = "2027-02-10T22:00:00Z";
  const end = "2027-02-12T16:00:00Z";

  it("allows up to capacity-many overlapping reservations", async () => {
    const a = await insertReservation({ suiteId: SUITE_CAP2, startAt: start, endAt: end });
    expect(a.error).toBeNull();
    const b = await insertReservation({ suiteId: SUITE_CAP2, startAt: start, endAt: end });
    expect(b.error).toBeNull();
  });

  it("rejects the third overlapping reservation", async () => {
    await insertReservation({ suiteId: SUITE_CAP2, startAt: start, endAt: end });
    await insertReservation({ suiteId: SUITE_CAP2, startAt: start, endAt: end });
    const { error } = await insertReservation({
      suiteId: SUITE_CAP2,
      startAt: start,
      endAt: end,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/at capacity|full for the requested|exclusion constraint/i);
  });
});
