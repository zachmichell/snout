import { describe, it, expect } from "vitest";
import {
  calculateSurchargeCents,
  surchargeApplies,
  DEFAULT_SURCHARGE_SETTINGS,
  CANADIAN_SURCHARGE_CAP_BP,
  type SurchargeSettings,
} from "@/lib/surcharge";

const ON: SurchargeSettings = {
  enabled: true,
  rate_basis_points: 240,
  applies_to_credit_only: true,
  customer_notice_text: "A 2.4% credit-card surcharge applies.",
  registered_with_card_networks: true,
};

describe("calculateSurchargeCents", () => {
  it("computes 2.4% on $100.00 as $2.40", () => {
    expect(calculateSurchargeCents({ amount_cents: 10000, rate_basis_points: 240 })).toBe(240);
  });

  it("computes 1% on $50.00 as $0.50", () => {
    expect(calculateSurchargeCents({ amount_cents: 5000, rate_basis_points: 100 })).toBe(50);
  });

  it("rounds half-up at the cent boundary", () => {
    // $33.33 at 2.4% = 79.992 cents, rounds to 80
    expect(calculateSurchargeCents({ amount_cents: 3333, rate_basis_points: 240 })).toBe(80);
    // $0.21 at 2.4% = 0.504 cents, rounds to 1
    expect(calculateSurchargeCents({ amount_cents: 21, rate_basis_points: 240 })).toBe(1);
  });

  it("clamps to the Canadian regulatory cap when given a higher rate", () => {
    // Operator config'd 5% but the system caps at 2.4%
    expect(calculateSurchargeCents({ amount_cents: 10000, rate_basis_points: 500 })).toBe(240);
    // Sanity: at the cap exactly, math is straight
    expect(calculateSurchargeCents({ amount_cents: 10000, rate_basis_points: CANADIAN_SURCHARGE_CAP_BP })).toBe(240);
  });

  it("returns 0 for non-positive amount or rate", () => {
    expect(calculateSurchargeCents({ amount_cents: 0, rate_basis_points: 240 })).toBe(0);
    expect(calculateSurchargeCents({ amount_cents: -100, rate_basis_points: 240 })).toBe(0);
    expect(calculateSurchargeCents({ amount_cents: 10000, rate_basis_points: 0 })).toBe(0);
    expect(calculateSurchargeCents({ amount_cents: 10000, rate_basis_points: -50 })).toBe(0);
  });

  it("returns 0 for non-finite inputs", () => {
    expect(calculateSurchargeCents({ amount_cents: Number.NaN, rate_basis_points: 240 })).toBe(0);
    expect(calculateSurchargeCents({ amount_cents: Infinity, rate_basis_points: 240 })).toBe(0);
    expect(calculateSurchargeCents({ amount_cents: 10000, rate_basis_points: Number.NaN })).toBe(0);
  });
});

describe("surchargeApplies", () => {
  it("permits surcharge when fully configured for a credit card", () => {
    expect(
      surchargeApplies({
        settings: ON,
        payment_method: "card",
        card_funding: "credit",
      }),
    ).toBe(true);
  });

  it("refuses when settings are disabled", () => {
    expect(
      surchargeApplies({
        settings: { ...ON, enabled: false },
        payment_method: "card",
        card_funding: "credit",
      }),
    ).toBe(false);
  });

  it("refuses when the operator has not attested to network registration", () => {
    expect(
      surchargeApplies({
        settings: { ...ON, registered_with_card_networks: false },
        payment_method: "card",
        card_funding: "credit",
      }),
    ).toBe(false);
  });

  it("refuses for non-card payment methods (cash, ACH, in-person)", () => {
    expect(surchargeApplies({ settings: ON, payment_method: "ach" })).toBe(false);
    expect(surchargeApplies({ settings: ON, payment_method: "in_person" })).toBe(false);
    expect(surchargeApplies({ settings: ON, payment_method: null })).toBe(false);
    expect(surchargeApplies({ settings: ON, payment_method: undefined })).toBe(false);
  });

  it("refuses on debit when applies_to_credit_only is true", () => {
    expect(
      surchargeApplies({ settings: ON, payment_method: "card", card_funding: "debit" }),
    ).toBe(false);
  });

  it("refuses on unknown funding when applies_to_credit_only is true", () => {
    // Conservative: if Stripe has not surfaced the funding type, do not assume credit.
    expect(
      surchargeApplies({ settings: ON, payment_method: "card", card_funding: "unknown" }),
    ).toBe(false);
    expect(surchargeApplies({ settings: ON, payment_method: "card" })).toBe(false);
  });

  it("permits surcharge on any card type when applies_to_credit_only is false", () => {
    const allCards: SurchargeSettings = { ...ON, applies_to_credit_only: false };
    expect(
      surchargeApplies({ settings: allCards, payment_method: "card", card_funding: "credit" }),
    ).toBe(true);
    expect(
      surchargeApplies({ settings: allCards, payment_method: "card", card_funding: "debit" }),
    ).toBe(true);
    expect(
      surchargeApplies({ settings: allCards, payment_method: "card", card_funding: "unknown" }),
    ).toBe(true);
  });

  it("refuses for the default off-state settings", () => {
    expect(
      surchargeApplies({
        settings: DEFAULT_SURCHARGE_SETTINGS,
        payment_method: "card",
        card_funding: "credit",
      }),
    ).toBe(false);
  });
});
