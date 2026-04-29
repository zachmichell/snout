// Translate Postgres / PostgREST errors into friendly user-facing
// messages. Call from React Query mutation onError handlers to avoid
// surfacing raw constraint names like
// "reservations_no_suite_overlap" directly in toasts.

type PgError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

// Code-level fallbacks (used when no constraint name matches).
const FRIENDLY_CODES: Record<string, string> = {
  "23505": "That already exists — try a different value.",
  "23503": "Can't do that — another record depends on this one.",
  "23514": "Some values don't meet the rules for this action.",
  "23P01": "Conflict: the resource is already booked in that time window.",
  "42501": "You don't have permission to do that.",
  "40001": "Try again — another change happened at the same time.",
};

// Constraint / trigger names → specific messages. When a PG error message
// contains one of these substrings, we prefer its mapping over the code
// fallback. Keep keys in sync with migration names.
const FRIENDLY_CONSTRAINTS: Record<string, string> = {
  // Booking exclusion constraints (20260424130300)
  reservations_no_suite_overlap:
    "That suite is already booked in this time window.",
  grooming_no_groomer_overlap:
    "That groomer already has an appointment at that time.",
  playgroup_no_pet_double_assign:
    "This pet is already in a playgroup in that time window.",
  kennel_no_pet_double_assign:
    "This pet is already in a kennel run in that time window.",
  // Cross-table triggers (20260424130500)
  "Pet % already has an overlapping playgroup assignment":
    "This pet is already assigned to a playgroup in that time window.",
  "Pet % already has an overlapping kennel run assignment":
    "This pet is already assigned to a kennel run in that time window.",
  // Invoice uniqueness (20260424130200, 20260424130100)
  uniq_invoices_reservation_live:
    "This reservation already has an invoice.",
  uniq_invoices_org_number_live:
    "Invoice number conflict — please try again.",
  // Payment dedup (20260424130400)
  uniq_payments_stripe_intent:
    "This payment has already been recorded.",
  // Leads shape checks (20260424210200)
  leads_name_length: "Name is required.",
  leads_email_shape: "Email address looks invalid.",
  leads_phone_length: "Phone number looks invalid.",
  leads_pet_name_length: "Pet name is too long.",
  leads_pet_breed_length: "Pet breed is too long.",
  leads_source_length: "Source is too long.",
  leads_notes_length: "Notes are too long.",
  // Membership / onboarding (20260424120000, 20260424130000)
  "Caller already has an active membership":
    "You're already part of an organization. Ask an admin to add you to another.",
  "Organization already has members":
    "This organization already has members — ask an admin to add you.",
  "Insufficient permissions":
    "You don't have permission to do that.",
  // Invoice state guards (20260424130400, client statusMut, markPaidMut)
  "Invoice state changed":
    "This invoice just changed — refreshing…",
  "Invoice is not in a payable state":
    "This invoice is no longer in a payable state — refreshing…",
  "Invoice has no outstanding balance":
    "This invoice has no outstanding balance.",
};

/**
 * Returns true when the PG error indicates the client's cached view of a
 * row is stale (some other writer moved the status / deleted the row).
 * Callers can use this to trigger a silent refetch in addition to a toast.
 */
export function isStaleStateError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as PgError;
  const haystack = `${e.message ?? ""} ${e.details ?? ""}`;
  return (
    haystack.includes("Invoice state changed") ||
    haystack.includes("Invoice is not in a payable state") ||
    haystack.includes("Invoice not found or deleted")
  );
}

export function pgErrorToMessage(err: unknown, fallback = "Something went wrong."): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (!(typeof err === "object")) return fallback;

  const e = err as PgError;
  const haystack = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`;

  for (const [needle, friendly] of Object.entries(FRIENDLY_CONSTRAINTS)) {
    // For PL/pgSQL format placeholders like "Pet % already has...", strip
    // the "%" and match a prefix. Otherwise substring match.
    const key = needle.includes("%") ? needle.split("%")[0].trim() : needle;
    if (haystack.includes(key)) return friendly;
  }

  if (e.code && FRIENDLY_CODES[e.code]) return FRIENDLY_CODES[e.code];
  return e.message || fallback;
}
