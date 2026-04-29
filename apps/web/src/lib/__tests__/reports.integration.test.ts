import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createTestClient } from "@/test/supabase-test-client";
import { fetchEndOfDay, fetchRevenueByDate } from "@/lib/reports";

// Integration tests for the financial-reporting helpers in src/lib/reports.ts.
//
// Goal: prove that the totals returned by fetchEndOfDay and fetchRevenueByDate
// match a direct sum from the seeded invoice / payment fixture, so a reporting
// regression cannot ship without breaking this test.
//
// Fixture model: a temporary organization plus an owner. All seeded invoices
// and payments live under that org. Tear-down deletes the org and cascades.

const sb = createTestClient();
const tag = `__test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let ORG_ID: string;
let OWNER_ID: string;

// Three paid invoices on three distinct days, all in CAD. Cents.
const FIXTURE_INVOICES = [
  { paid_at: "2027-03-10T15:00:00Z", total: 5000, tax: 250 }, // Mar 10
  { paid_at: "2027-03-10T19:00:00Z", total: 7500, tax: 375 }, // Mar 10
  { paid_at: "2027-03-11T12:00:00Z", total: 12000, tax: 600 }, // Mar 11
  { paid_at: "2027-03-12T17:00:00Z", total: 4400, tax: 220 }, // Mar 12
];

beforeAll(async () => {
  const { data: org, error: orgErr } = await sb
    .from("organizations")
    .insert({ name: tag, slug: tag, country: "CA", currency: "CAD" })
    .select("id")
    .single();
  if (orgErr) throw orgErr;
  ORG_ID = org!.id;

  const { data: owner, error: ownerErr } = await sb
    .from("owners")
    .insert({
      organization_id: ORG_ID,
      first_name: "Reports",
      last_name: "Tester",
      external_source: "integration-test-fixture",
    })
    .select("id")
    .single();
  if (ownerErr) throw ownerErr;
  OWNER_ID = owner!.id;

  for (const f of FIXTURE_INVOICES) {
    const { data: inv, error: invErr } = await sb
      .from("invoices")
      .insert({
        organization_id: ORG_ID,
        owner_id: OWNER_ID,
        currency: "CAD",
        total_cents: f.total,
        tax_cents: f.tax,
        amount_paid_cents: f.total,
        balance_due_cents: 0,
        status: "paid",
        paid_at: f.paid_at,
      })
      .select("id")
      .single();
    if (invErr) throw invErr;

    // One succeeded payment per invoice.
    const { error: payErr } = await sb.from("payments").insert({
      organization_id: ORG_ID,
      invoice_id: inv!.id,
      amount_cents: f.total,
      currency: "CAD",
      method: "in_person",
      status: "succeeded",
      processed_at: f.paid_at,
    });
    if (payErr) throw payErr;
  }

  // One refund on Mar 11 to exercise the refunds path.
  const { data: refundedInv, error: refundedInvErr } = await sb
    .from("invoices")
    .insert({
      organization_id: ORG_ID,
      owner_id: OWNER_ID,
      currency: "CAD",
      total_cents: 3000,
      tax_cents: 150,
      amount_paid_cents: 3000,
      balance_due_cents: 0,
      status: "paid",
      paid_at: "2027-03-11T09:00:00Z",
    })
    .select("id")
    .single();
  if (refundedInvErr) throw refundedInvErr;
  const { error: refundErr } = await sb.from("payments").insert({
    organization_id: ORG_ID,
    invoice_id: refundedInv!.id,
    amount_cents: 1500,
    currency: "CAD",
    method: "card",
    status: "refunded",
    processed_at: "2027-03-11T14:00:00Z",
  });
  if (refundErr) throw refundErr;
});

afterAll(async () => {
  if (ORG_ID) await sb.from("organizations").delete().eq("id", ORG_ID);
});

describe("fetchEndOfDay", () => {
  it("ties out to direct sums for Mar 10", async () => {
    const result = await fetchEndOfDay(ORG_ID, new Date("2027-03-10T12:00:00Z"));
    // Two invoices on Mar 10: 5000 + 7500 = 12500, tax 250 + 375 = 625
    expect(result.revenue).toBe(12500);
    expect(result.tax).toBe(625);
    expect(result.invoiceCount).toBe(2);
    // Two succeeded payments on Mar 10
    expect(result.transactions).toBe(2);
    // No refunds on Mar 10
    expect(result.refunds).toBe(0);
  });

  it("captures a refund on Mar 11", async () => {
    const result = await fetchEndOfDay(ORG_ID, new Date("2027-03-11T12:00:00Z"));
    // Two invoices paid on Mar 11: 12000 + 3000 = 15000, tax 600 + 150 = 750
    expect(result.revenue).toBe(15000);
    expect(result.tax).toBe(750);
    expect(result.invoiceCount).toBe(2);
    // Two succeeded payments + one refunded payment that day, transactions
    // count succeeded only.
    expect(result.transactions).toBe(2);
    // The refund of 1500 must show up.
    expect(result.refunds).toBe(1500);
  });

  it("returns zero on a day with no activity", async () => {
    const result = await fetchEndOfDay(ORG_ID, new Date("2027-03-15T12:00:00Z"));
    expect(result.revenue).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.invoiceCount).toBe(0);
    expect(result.transactions).toBe(0);
    expect(result.refunds).toBe(0);
  });
});

describe("fetchRevenueByDate", () => {
  const range = {
    from: new Date("2027-03-01T00:00:00Z"),
    to: new Date("2027-03-31T23:59:59Z"),
  };

  it("buckets by day and ties out per bucket", async () => {
    const rows = await fetchRevenueByDate(ORG_ID, range, "day");
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]));

    // Mar 10: 5000 + 7500 = 12500, count 2
    expect(byPeriod["2027-03-10"]?.revenue).toBe(12500);
    expect(byPeriod["2027-03-10"]?.count).toBe(2);

    // Mar 11: 12000 + 3000 = 15000, count 2
    expect(byPeriod["2027-03-11"]?.revenue).toBe(15000);
    expect(byPeriod["2027-03-11"]?.count).toBe(2);

    // Mar 12: 4400, count 1
    expect(byPeriod["2027-03-12"]?.revenue).toBe(4400);
    expect(byPeriod["2027-03-12"]?.count).toBe(1);
  });

  it("buckets by month and ties out to the all-fixtures total", async () => {
    const rows = await fetchRevenueByDate(ORG_ID, range, "month");
    const total = rows.reduce((acc, r) => acc + r.revenue, 0);
    const directSum =
      FIXTURE_INVOICES.reduce((acc, f) => acc + f.total, 0) + 3000;
    expect(total).toBe(directSum); // 31900
    expect(rows).toHaveLength(1);
    expect(rows[0].period).toBe("2027-03");
    expect(rows[0].count).toBe(5);
  });

  it("excludes invoices outside the range", async () => {
    const narrow = {
      from: new Date("2027-03-11T00:00:00Z"),
      to: new Date("2027-03-11T23:59:59Z"),
    };
    const rows = await fetchRevenueByDate(ORG_ID, narrow, "day");
    expect(rows).toHaveLength(1);
    expect(rows[0].revenue).toBe(15000);
    expect(rows[0].count).toBe(2);
  });
});
