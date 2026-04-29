export type DepositSettings = {
  id: string;
  organization_id: string;
  enabled: boolean;
  amount_type: "fixed" | "percentage";
  default_amount_cents: number;
  default_percentage_bp: number; // basis points: 2500 = 25.00%
  refund_policy: "full" | "partial" | "none";
  refund_cutoff_hours: number;
};

export type DepositStatus = "pending" | "paid" | "refunded" | "forfeited";

export function depositStatusLabel(s: string) {
  switch (s) {
    case "pending":
      return "Pending";
    case "paid":
      return "Paid";
    case "refunded":
      return "Refunded";
    case "forfeited":
      return "Forfeited";
    default:
      return s;
  }
}

export function refundPolicyLabel(p: string) {
  switch (p) {
    case "full":
      return "Fully refundable";
    case "partial":
      return "Partially refundable";
    case "none":
      return "Non-refundable";
    default:
      return p;
  }
}

/**
 * Compute deposit amount in cents for a given total, applying
 * an optional service-level override on top of the org default.
 */
export function computeDepositCents(
  totalCents: number,
  settings: Pick<DepositSettings, "amount_type" | "default_amount_cents" | "default_percentage_bp"> | null,
  override?: { amount_type: "fixed" | "percentage"; amount_cents: number; percentage_bp: number; enabled: boolean } | null,
): number {
  if (override && override.enabled) {
    if (override.amount_type === "fixed") return Math.max(0, Math.round(override.amount_cents));
    return Math.max(0, Math.round((totalCents * (override.percentage_bp ?? 0)) / 10000));
  }
  if (!settings) return 0;
  if (settings.amount_type === "fixed") return Math.max(0, Math.round(settings.default_amount_cents));
  return Math.max(0, Math.round((totalCents * (settings.default_percentage_bp ?? 0)) / 10000));
}

export function formatPercentBp(bp: number): string {
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
}
