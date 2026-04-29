/**
 * Credit-card surcharge calculation.
 *
 * Canadian regulatory context: under the October 2022 Visa and Mastercard
 * settlement, merchants in Canada may surcharge credit-card payments up to
 * 2.4% of the transaction amount, after registering with the card networks.
 * Debit cards remain exempt. Each province has additional rules about how
 * the surcharge must be disclosed to the customer; the merchant attests
 * compliance via `registered_with_card_networks`. The schema CHECK
 * constraint and this module's CANADIAN_SURCHARGE_CAP_BP both refuse rates
 * above the cap.
 *
 * The calculator is pure: takes amount + rate, returns surcharge cents.
 * Whether to apply surcharge to a given payment is a separate decision,
 * `surchargeApplies`, that the caller composes from settings + payment
 * method + (Stripe-provided) card funding type.
 */

export const CANADIAN_SURCHARGE_CAP_BP = 240;

export type SurchargeSettings = {
  enabled: boolean;
  rate_basis_points: number;
  applies_to_credit_only: boolean;
  customer_notice_text: string | null;
  registered_with_card_networks: boolean;
};

export const DEFAULT_SURCHARGE_SETTINGS: SurchargeSettings = {
  enabled: false,
  rate_basis_points: 0,
  applies_to_credit_only: true,
  customer_notice_text: null,
  registered_with_card_networks: false,
};

/**
 * Surcharge in cents on `amount_cents` at `rate_basis_points`.
 * Caps at the regulatory maximum. Returns 0 for non-positive inputs.
 *
 * Half-up rounding at the cent boundary (Math.round). For a $100.00
 * subtotal at 2.4%, the surcharge is exactly $2.40. For $33.33 at 2.4%
 * the result is $0.80 (3333 * 240 / 10000 = 79.992 cents, rounds to 80).
 */
export function calculateSurchargeCents(args: {
  amount_cents: number;
  rate_basis_points: number;
}): number {
  if (!Number.isFinite(args.amount_cents) || args.amount_cents <= 0) return 0;
  if (!Number.isFinite(args.rate_basis_points) || args.rate_basis_points <= 0) return 0;
  const effective_bp = Math.min(args.rate_basis_points, CANADIAN_SURCHARGE_CAP_BP);
  return Math.round((args.amount_cents * effective_bp) / 10000);
}

export type CardFunding = "credit" | "debit" | "prepaid" | "unknown" | null;

/**
 * Returns true when the configured settings + payment context permit a
 * surcharge. Specifically:
 *
 *   - settings.enabled must be true
 *   - settings.registered_with_card_networks must be true (legal attestation)
 *   - the payment method must be card-rail (cash, ACH, store-credit are out)
 *   - if settings.applies_to_credit_only, the funding type must be 'credit'
 *
 * The funding-type check is conservative: if Stripe has not yet returned
 * a funding signal (or returned 'unknown'), and applies_to_credit_only is
 * true, we refuse to surcharge rather than assume credit.
 */
export function surchargeApplies(args: {
  settings: SurchargeSettings;
  payment_method: string | null | undefined;
  card_funding?: CardFunding;
}): boolean {
  const s = args.settings;
  if (!s.enabled) return false;
  if (!s.registered_with_card_networks) return false;
  const method = (args.payment_method ?? "").toLowerCase();
  if (method !== "card") return false;
  if (s.applies_to_credit_only && args.card_funding !== "credit") return false;
  return true;
}
